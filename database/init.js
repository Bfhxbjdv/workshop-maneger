const db = require('./connection');

async function initDatabase() {
  await db.getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS Users (
      User_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Name TEXT NOT NULL,
      Role TEXT NOT NULL CHECK(Role IN ('Admin','Designer','Laser_Op','Router_Op')),
      Username TEXT UNIQUE NOT NULL,
      Password TEXT NOT NULL,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Clients (
      Client_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Full_Name TEXT NOT NULL,
      Phone_Number TEXT,
      Rating INTEGER DEFAULT 3 CHECK(Rating BETWEEN 1 AND 5),
      Total_Spent REAL DEFAULT 0,
      Notes TEXT,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Inventory (
      Material_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Material_Name TEXT NOT NULL,
      Thickness TEXT,
      Quantity REAL DEFAULT 0,
      Cost_Per_Unit REAL DEFAULT 0,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Orders (
      Task_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Client_ID INTEGER NOT NULL,
      Designer_ID INTEGER,
      Machine_Type TEXT NOT NULL CHECK(Machine_Type IN ('Laser','Router')),
      Status TEXT NOT NULL DEFAULT 'قيد التصميم' CHECK(Status IN ('قيد التصميم','جاهز للقص','قيد التنفيذ','تم التغليف','تم التسليم')),
      Material_ID INTEGER,
      Material_Qty REAL DEFAULT 0,
      File_Path TEXT,
      File_Name TEXT,
      Notes TEXT,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP,
      Updated_At DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (Client_ID) REFERENCES Clients(Client_ID),
      FOREIGN KEY (Designer_ID) REFERENCES Users(User_ID),
      FOREIGN KEY (Material_ID) REFERENCES Inventory(Material_ID)
    );

    CREATE TABLE IF NOT EXISTS Order_Materials (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Task_ID INTEGER NOT NULL,
      Material_ID INTEGER NOT NULL,
      Quantity REAL DEFAULT 0,
      FOREIGN KEY (Task_ID) REFERENCES Orders(Task_ID) ON DELETE CASCADE,
      FOREIGN KEY (Material_ID) REFERENCES Inventory(Material_ID)
    );

    CREATE TABLE IF NOT EXISTS Notifications (
      Notif_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Task_ID INTEGER,
      Message TEXT NOT NULL,
      Type TEXT DEFAULT 'info',
      Is_Read INTEGER DEFAULT 0,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (Task_ID) REFERENCES Orders(Task_ID)
    );
  `);

  const existing = db.query("SELECT COUNT(*) as cnt FROM Users");
  if (existing[0].cnt === 0) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin123', 10);
    db.run(
      "INSERT INTO Users (Name, Role, Username, Password) VALUES (?, ?, ?, ?)",
      ['مدير النظام', 'Admin', 'admin', hash]
    );
    db.run(
      "INSERT INTO Users (Name, Role, Username, Password) VALUES (?, ?, ?, ?)",
      ['مصمم 1', 'Designer', 'designer', bcrypt.hashSync('designer123', 10)]
    );
    db.run(
      "INSERT INTO Users (Name, Role, Username, Password) VALUES (?, ?, ?, ?)",
      ['عامل ليزر', 'Laser_Op', 'laser', bcrypt.hashSync('laser123', 10)]
    );
    db.run(
      "INSERT INTO Users (Name, Role, Username, Password) VALUES (?, ?, ?, ?)",
      ['عامل راوتر', 'Router_Op', 'router', bcrypt.hashSync('router123', 10)]
    );
    console.log('✅ Users seeded');
  }

  console.log('✅ Database initialized');
}

if (require.main === module) {
  initDatabase().then(() => { console.log('Done'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}

module.exports = initDatabase;
