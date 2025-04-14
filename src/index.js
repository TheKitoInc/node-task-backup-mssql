const mssql = require("mssql");

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

require("dotenv").config();

const config = {
  user: process.env.MSSQL_USER || "sa",
  password: process.env.MSSQL_PASSWORD || "",
  server: process.env.MSSQL_SERVER || "localhost",
  port: Number(process.env.MSSQL_PORT || 1433),
  options: {
    encrypt: false,
    trustServerCertificate: true,
    requestTimeout: 360000, // 1 hour
  },
};

async function getConnection() {
  try {
    const pool = await mssql.connect(config);
    console.log("Connected to MSSQL database.");
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
    const backupDirectory = await getBackupDirectory(connection);
    const databases = await getDatabases(connection);

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
  } catch (err) {
    console.error("Error in backup process:", err);
  }
}

main();
