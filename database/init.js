const db = require('./connection');
const bcrypt = require('bcryptjs');

async function initDatabase() {
  await db.getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS Users (
      User_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Name TEXT NOT NULL,
      Role TEXT NOT NULL CHECK(Role IN ('Admin','Designer','Laser_Op','Router_Op','Custom')),
      Username TEXT UNIQUE NOT NULL,
      Password TEXT NOT NULL,
      Permissions TEXT DEFAULT '{}',
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
      Price REAL DEFAULT 0,
      Cost REAL DEFAULT 0,
      Profit REAL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS Invoices (
      Invoice_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Order_Task_ID INTEGER NOT NULL,
      Client_ID INTEGER NOT NULL,
      Invoice_Number TEXT UNIQUE NOT NULL,
      Amount REAL NOT NULL,
      Amount_Paid REAL DEFAULT 0,
      Payment_Method TEXT DEFAULT 'نقداً',
      Status TEXT NOT NULL DEFAULT 'مدفوعة' CHECK(Status IN ('مدفوعة','غير مدفوعة','ملغية')),
      Notes TEXT,
      File_Path TEXT,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (Order_Task_ID) REFERENCES Orders(Task_ID),
      FOREIGN KEY (Client_ID) REFERENCES Clients(Client_ID)
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

    CREATE TABLE IF NOT EXISTS Expenses (
      Expense_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Description TEXT NOT NULL,
      Category TEXT NOT NULL DEFAULT 'أخرى',
      Amount REAL NOT NULL,
      Expense_Date TEXT NOT NULL,
      Notes TEXT,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Order_Files (
      File_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Task_ID INTEGER NOT NULL,
      Original_Name TEXT NOT NULL,
      Stored_Name TEXT NOT NULL,
      File_Path TEXT NOT NULL,
      GDrive_File_ID TEXT,
      File_Size REAL DEFAULT 0,
      Uploaded_By INTEGER,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (Task_ID) REFERENCES Orders(Task_ID) ON DELETE CASCADE,
      FOREIGN KEY (Uploaded_By) REFERENCES Users(User_ID)
    );

    CREATE TABLE IF NOT EXISTS Upload_Queue (
      Queue_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Task_ID INTEGER NOT NULL,
      Client_Name TEXT,
      Original_Name TEXT NOT NULL,
      File_Path TEXT NOT NULL,
      File_Buffer BLOB,
      Status TEXT DEFAULT 'pending' CHECK(Status IN ('pending','uploading','done','failed')),
      Error TEXT,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS System_Logs (
      Log_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Action TEXT NOT NULL,
      User_ID INTEGER,
      Details TEXT,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const existing = db.query("SELECT COUNT(*) as cnt FROM Users");
  if (existing[0].cnt === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.run("INSERT INTO Users (Name, Role, Username, Password) VALUES (?, ?, ?, ?)", ['مدير النظام', 'Admin', 'admin', hash]);
    db.run("INSERT INTO Users (Name, Role, Username, Password) VALUES (?, ?, ?, ?)", ['مصمم 1', 'Designer', 'designer', bcrypt.hashSync('designer123', 10)]);
    db.run("INSERT INTO Users (Name, Role, Username, Password) VALUES (?, ?, ?, ?)", ['عامل ليزر', 'Laser_Op', 'laser', bcrypt.hashSync('laser123', 10)]);
    db.run("INSERT INTO Users (Name, Role, Username, Password) VALUES (?, ?, ?, ?)", ['عامل راوتر', 'Router_Op', 'router', bcrypt.hashSync('router123', 10)]);
    console.log('✅ Users seeded');
  }

  try {
    db.exec("ALTER TABLE Users ADD COLUMN Permissions TEXT DEFAULT '{}'");
    console.log('✅ Added Permissions column');
  } catch (e) {}

  try {
    db.exec("ALTER TABLE Users ADD COLUMN Created_At DATETIME DEFAULT CURRENT_TIMESTAMP");
  } catch (e) {}

  try {
    db.exec(`CREATE TABLE IF NOT EXISTS Order_Files (
      File_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Task_ID INTEGER NOT NULL,
      Original_Name TEXT NOT NULL,
      Stored_Name TEXT NOT NULL,
      File_Path TEXT NOT NULL,
      GDrive_File_ID TEXT,
      File_Size REAL DEFAULT 0,
      Uploaded_By INTEGER,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (Task_ID) REFERENCES Orders(Task_ID) ON DELETE CASCADE,
      FOREIGN KEY (Uploaded_By) REFERENCES Users(User_ID)
    )`);
    console.log('✅ Order_Files table ready');
  } catch (e) {}

  try {
    const cols = db.query("PRAGMA table_info(Users)");
    const hasCustom = cols.some(c => c.name === 'Role');
    if (hasCustom) {
      const users = db.all("SELECT * FROM Users");
      db.exec("DROP TABLE IF EXISTS Users_backup");
      db.exec(`CREATE TABLE Users_backup (
        User_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Name TEXT NOT NULL,
        Role TEXT NOT NULL,
        Username TEXT UNIQUE NOT NULL,
        Password TEXT NOT NULL,
        Permissions TEXT DEFAULT '{}',
        Created_At DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      users.forEach(u => {
        db.run("INSERT INTO Users_backup (User_ID, Name, Role, Username, Password, Permissions, Created_At) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [u.User_ID, u.Name, u.Role, u.Username, u.Password, u.Permissions || '{}', u.Created_At]);
      });
      db.exec("DROP TABLE Users");
      db.exec("ALTER TABLE Users_backup RENAME TO Users");
      console.log('✅ Recreated Users table without CHECK constraint');
    }
  } catch (e) {}

  console.log('✅ Database initialized');
}

if (require.main === module) {
  initDatabase().then(() => { console.log('Done'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}

module.exports = initDatabase;
