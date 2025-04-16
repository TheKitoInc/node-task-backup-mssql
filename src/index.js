require("dotenv").config();

const mssql = require("mssql");
const yargs = require('yargs');

const queryShowDataBases =
  "SELECT name FROM sys.databases WHERE state_desc = 'ONLINE' AND name NOT IN ('master', 'tempdb', 'model', 'msdb')";

const queryGetBackupDirectory = `DECLARE @BackupDirectory NVARCHAR(512);
  EXEC master.dbo.xp_instance_regread
      N'HKEY_LOCAL_MACHINE',
      N'SOFTWARE\\Microsoft\\MSSQLServer\\MSSQLServer',
      N'BackupDirectory',
      @BackupDirectory OUTPUT;
  SELECT @BackupDirectory AS DefaultBackupDirectory;`;

const queryBackupDatabase = (database, pathFile) =>
  `BACKUP DATABASE [${database}] TO DISK='${pathFile}' WITH FORMAT, INIT, SKIP, NOREWIND, NOUNLOAD, STATS=10`;

const argv = yargs
  .option('MSSQL_USER', {
    describe: 'MSSQL username',
    type: 'string',
    demandOption: true,
    default: process.env.MSSQL_USER,
  })
  .option('MSSQL_PASSWORD', {
    describe: 'MSSQL password',
    type: 'string',
    demandOption: false,
    default: process.env.MSSQL_PASSWORD,
  })
  .option('MSSQL_HOST', {
    describe: 'MSSQL host',
    type: 'string',
    default: process.env.MSSQL_HOST || 'localhost',
  })
  .option('MSSQL_PORT', {
    describe: 'MSSQL port',
    type: 'number',
    default: Number(process.env.MSSQL_PORT) || 1433,
  })
  .option('MSSQL_DIRECTORY', {
    describe: 'Backup directory',
    type: 'string',
    default: process.env.MSSQL_DIRECTORY || null,
  })
  .help()
  .argv;

// Use the parsed options
console.log('MSSQL Config:');
console.log({
  user: argv.MSSQL_USER,
  host: argv.MSSQL_HOST,
  port: argv.MSSQL_PORT,
  directory: argv.MSSQL_DIRECTORY,
});


const config = {
  user: argv.MSSQL_USER,
  password: argv.MSSQL_PASSWORD,
  server: argv.MSSQL_HOST,
  port: argv.MSSQL_PORT,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    requestTimeout: 360000, // 1 hour
  },
};

async function getConnection() {
  try {
    const pool = await mssql.connect(config);    
    return pool;
  } catch (err) {
    throw err;
  }
}

async function query(connection, query) {
  try {
    const result = await connection.request().query(query);

    return result.recordset;
  } catch (err) {
    throw err;
  }
}


async function getBackupDirectory(connection) {
  return argv.MSSQL_DIRECTORY|| getServerBackupDirectory(connection);  
}

async function getServerBackupDirectory(connection) {
  try {
    const result = await query(connection, queryGetBackupDirectory);
    if (result.length === 0) {
      throw new Error("No backup directory found.");
    }
    const path = result[0]?.DefaultBackupDirectory;
    if (!path) {
      throw new Error("Default backup directory not found.");
    }
    return path;
  } catch (err) {
    throw err;
  }
}

async function getDatabases(connection) {
  try {
    const result = await query(connection, queryShowDataBases);
    return result.map((row) => row.name);
  } catch (err) {
    throw err;
  }
}

async function main() {
  try {
    const connection = await getConnection();
    console.log("Connected to MSSQL database.");

    const backupDirectory = await getBackupDirectory(connection);
    console.log("Backup directory:", backupDirectory);

    const databases = await getDatabases(connection);
    console.log("Databases:", databases);

    for (const database of databases) {
      const timestamp = new Date()
        .toISOString()
        .replace(/:/g, "-")
        .replace(/\..+/, "");
      const backupFile = `${backupDirectory}\\${database}-${timestamp}.bak`;
      const backupQuery = queryBackupDatabase(database, backupFile);

      try {
        console.log(`Backing up database: ${database}`);
        await query(connection, backupQuery);
        console.log(
          `Database ${database} backed up successfully to ${backupFile}`
        );
      } catch (err) {
        console.error(`Error backing up database ${database}:`, err);
      }
    }

    await connection.close();
    console.log("Connection closed.");
  } catch (err) {
    console.error("Error in backup process:", err);
  }
}

main();