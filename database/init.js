const db = require('./connection');
const bcrypt = require('bcryptjs');

async function initDatabase() {
  await db.getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS Users (
      User_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Name TEXT NOT NULL,
      Role TEXT NOT NULL CHECK(Role IN ('Admin','Designer','Laser_Op','Router_Op','Custom','Agent')),
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
      Status TEXT NOT NULL DEFAULT 'قيد التصميم' CHECK(Status IN ('قيد التصميم','جاهز للقص','قيد التنفيذ','تم الانتهاء من القص','تم التغليف','تم التسليم')),
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
      Label TEXT DEFAULT '',
      File_Type TEXT DEFAULT 'design',
      Uploaded_By INTEGER,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (Task_ID) REFERENCES Orders(Task_ID) ON DELETE CASCADE,
      FOREIGN KEY (Uploaded_By) REFERENCES Users(User_ID)
    );

    CREATE TABLE IF NOT EXISTS Receipts (
      Receipt_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Receipt_Number TEXT UNIQUE NOT NULL,
      Order_Task_ID INTEGER NOT NULL,
      Client_ID INTEGER NOT NULL,
      Amount REAL DEFAULT 0,
      Notes TEXT,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (Order_Task_ID) REFERENCES Orders(Task_ID),
      FOREIGN KEY (Client_ID) REFERENCES Clients(Client_ID)
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

    CREATE TABLE IF NOT EXISTS Designs (
      Design_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Name TEXT NOT NULL,
      Category TEXT DEFAULT '',
      Material TEXT DEFAULT '',
      Thickness TEXT DEFAULT '',
      Width REAL DEFAULT 0,
      Height REAL DEFAULT 0,
      Unit TEXT DEFAULT 'سم',
      Notes TEXT DEFAULT '',
      FilePath TEXT NOT NULL,
      Original_Name TEXT NOT NULL,
      ThumbnailPath TEXT DEFAULT NULL,
      Password TEXT DEFAULT NULL,
      CreatedBy INTEGER,
      CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (CreatedBy) REFERENCES Users(User_ID)
    );

    CREATE TABLE IF NOT EXISTS Design_Permissions (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Design_ID INTEGER NOT NULL,
      User_ID INTEGER NOT NULL,
      FOREIGN KEY (Design_ID) REFERENCES Designs(Design_ID) ON DELETE CASCADE,
      FOREIGN KEY (User_ID) REFERENCES Users(User_ID) ON DELETE CASCADE,
      UNIQUE(Design_ID, User_ID)
    );

    CREATE TABLE IF NOT EXISTS Agent_Images (
      Image_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Category TEXT NOT NULL DEFAULT 'عام',
      Original_Name TEXT NOT NULL,
      Stored_Name TEXT NOT NULL,
      File_Path TEXT NOT NULL,
      File_Size REAL DEFAULT 0,
      Uploaded_By INTEGER,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (Uploaded_By) REFERENCES Users(User_ID)
    );

    CREATE TABLE IF NOT EXISTS Agent_Shapes (
      Shape_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Name TEXT NOT NULL,
      Description TEXT,
      Image_ID INTEGER,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (Image_ID) REFERENCES Agent_Images(Image_ID) ON DELETE SET NULL
    );
  `);

  const existing = db.query("SELECT COUNT(*) as cnt FROM Users");
  if (existing[0].cnt === 0) {
    const password = process.env.INITIAL_ADMIN_PASSWORD;
    if (!password || password.length < 12) {
      throw new Error('قاعدة البيانات الجديدة تحتاج INITIAL_ADMIN_PASSWORD بطول 12 حرفاً على الأقل');
    }
    const username = process.env.INITIAL_ADMIN_USERNAME || 'admin';
    db.run("INSERT INTO Users (Name, Role, Username, Password) VALUES (?, ?, ?, ?)", ['مدير النظام', 'Admin', username, bcrypt.hashSync(password, 12)]);
    console.log('✅ تم إنشاء حساب المدير الأول');
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
      Label TEXT DEFAULT '',
      File_Type TEXT DEFAULT 'design',
      Uploaded_By INTEGER,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (Task_ID) REFERENCES Orders(Task_ID) ON DELETE CASCADE,
      FOREIGN KEY (Uploaded_By) REFERENCES Users(User_ID)
    )`);
    console.log('✅ Order_Files table ready');
  } catch (e) {}

  try {
    db.exec("ALTER TABLE Orders ADD COLUMN Created_By INTEGER");
    console.log('✅ Added Created_By column to Orders');
  } catch (e) {}

  try {
    db.exec("ALTER TABLE Orders ADD COLUMN Approval_Status TEXT DEFAULT 'approved' CHECK(Approval_Status IN ('pending','approved','rejected'))");
    console.log('✅ Added Approval_Status column to Orders');
  } catch (e) {}

  try {
    const fileCols = db.query("PRAGMA table_info(Order_Files)");
    if (!fileCols.some(c => c.name === 'Label')) { db.exec("ALTER TABLE Order_Files ADD COLUMN Label TEXT DEFAULT ''"); console.log('✅ Added Label column'); }
    if (!fileCols.some(c => c.name === 'File_Type')) { db.exec("ALTER TABLE Order_Files ADD COLUMN File_Type TEXT DEFAULT 'design'"); console.log('✅ Added File_Type column'); }
  } catch (e) {}

  try {
    db.exec(`CREATE TABLE IF NOT EXISTS Receipts (
      Receipt_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Receipt_Number TEXT UNIQUE NOT NULL,
      Order_Task_ID INTEGER NOT NULL,
      Client_ID INTEGER NOT NULL,
      Amount REAL DEFAULT 0,
      Notes TEXT,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (Order_Task_ID) REFERENCES Orders(Task_ID),
      FOREIGN KEY (Client_ID) REFERENCES Clients(Client_ID)
    )`);
    console.log('✅ Receipts table ready');
  } catch (e) {}

  try {
    const cols = db.query("PRAGMA table_info(Users)");
    const userSql = db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='Users'");
    const needsCustomRoleMigration = userSql.length && /CHECK/i.test(userSql[0].sql || '') && !/(?:'Custom'|\"Custom\")/.test(userSql[0].sql || '');
    if (needsCustomRoleMigration) {
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

  try {
    const ordersSql = db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='Orders'");
    if (ordersSql.length && !(ordersSql[0].sql || '').includes('تم الانتهاء من القص')) {
      db.run('PRAGMA foreign_keys=OFF');
      const orders = db.all("SELECT * FROM Orders");
      db.exec("DROP TABLE IF EXISTS Orders_backup");
      db.exec(`CREATE TABLE Orders_backup (
        Task_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Client_ID INTEGER NOT NULL,
        Designer_ID INTEGER,
        Machine_Type TEXT NOT NULL,
        Status TEXT NOT NULL DEFAULT 'قيد التصميم',
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
      )`);
      orders.forEach(o => {
        db.run(`INSERT INTO Orders_backup (Task_ID, Client_ID, Designer_ID, Machine_Type, Status, Material_ID, Material_Qty, Price, Cost, Profit, File_Path, File_Name, Notes, Created_At, Updated_At)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [o.Task_ID, o.Client_ID, o.Designer_ID, o.Machine_Type, o.Status, o.Material_ID, o.Material_Qty, o.Price, o.Cost, o.Profit, o.File_Path, o.File_Name, o.Notes, o.Created_At, o.Updated_At]);
      });
      db.exec("DROP TABLE Orders");
      db.exec("ALTER TABLE Orders_backup RENAME TO Orders");
      db.run('PRAGMA foreign_keys=ON');
      console.log('✅ Recreated Orders table with new status');
    }
  } catch (e) { console.log('⚠️ Orders migration skipped:', typeof e, e && (e.message || String(e))); }

  try {
    db.exec(`CREATE TABLE IF NOT EXISTS Designs (
      Design_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Name TEXT NOT NULL,
      Category TEXT DEFAULT '',
      Material TEXT DEFAULT '',
      Thickness TEXT DEFAULT '',
      Width REAL DEFAULT 0,
      Height REAL DEFAULT 0,
      Unit TEXT DEFAULT 'سم',
      Notes TEXT DEFAULT '',
      FilePath TEXT NOT NULL,
      Original_Name TEXT NOT NULL,
      ThumbnailPath TEXT DEFAULT NULL,
      Password TEXT DEFAULT NULL,
      CreatedBy INTEGER,
      CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (CreatedBy) REFERENCES Users(User_ID)
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS Design_Permissions (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Design_ID INTEGER NOT NULL,
      User_ID INTEGER NOT NULL,
      FOREIGN KEY (Design_ID) REFERENCES Designs(Design_ID) ON DELETE CASCADE,
      FOREIGN KEY (User_ID) REFERENCES Users(User_ID) ON DELETE CASCADE,
      UNIQUE(Design_ID, User_ID)
    )`);
    console.log('✅ Designs tables ready');
  } catch (e) {}

  console.log('✅ Database initialized');
}

if (require.main === module) {
  initDatabase().then(() => { console.log('Done'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}

module.exports = initDatabase;
