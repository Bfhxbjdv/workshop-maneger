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
      Upload_Type TEXT DEFAULT 'design' CHECK(Upload_Type IN ('design', 'agent_custom', 'admin_library', 'agent_image', 'agent_shape')),
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
      Design_ID INTEGER REFERENCES Designs(Design_ID),
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

    CREATE TABLE IF NOT EXISTS Product_Pricing (
      Pricing_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Product_Name TEXT NOT NULL,
      Category TEXT DEFAULT 'عام',
      Base_Price REAL NOT NULL DEFAULT 0,
      Unit TEXT DEFAULT 'لوح',
      Description TEXT,
      Is_Active INTEGER DEFAULT 1,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP,
      Updated_At DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Client_Pricing (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Client_ID INTEGER NOT NULL,
      Pricing_ID INTEGER NOT NULL,
      Agent_Price REAL NOT NULL,
      Agent_Commission REAL DEFAULT 0,
      Final_Price REAL NOT NULL,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (Client_ID) REFERENCES Clients(Client_ID) ON DELETE CASCADE,
      FOREIGN KEY (Pricing_ID) REFERENCES Product_Pricing(Pricing_ID) ON DELETE CASCADE,
      UNIQUE(Client_ID, Pricing_ID)
    );

    CREATE TABLE IF NOT EXISTS Agent_Profiles (
      Agent_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      User_ID INTEGER UNIQUE NOT NULL REFERENCES Users(User_ID),
      Phone TEXT,
      Email TEXT,
      Territory TEXT,
      Commission_Rate REAL DEFAULT 0.10,
      Bank_Account TEXT,
      IBAN TEXT,
      Tax_Number TEXT,
      Status TEXT DEFAULT 'active' CHECK(Status IN ('active','inactive','suspended')),
      Hired_Date DATE DEFAULT CURRENT_DATE,
      Notes TEXT
    );

    CREATE TABLE IF NOT EXISTS Agent_Stats (
      Stat_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Agent_ID INTEGER NOT NULL REFERENCES Users(User_ID),
      Stat_Date DATE NOT NULL,
      Period_Type TEXT CHECK(Period_Type IN ('daily','weekly','monthly')),
      Orders_Count INTEGER DEFAULT 0,
      Total_Sheets REAL DEFAULT 0,
      Total_Revenue REAL DEFAULT 0,
      Total_Commission REAL DEFAULT 0,
      Pending_Orders INTEGER DEFAULT 0,
      Approved_Orders INTEGER DEFAULT 0,
      Rejected_Orders INTEGER DEFAULT 0,
      New_Clients INTEGER DEFAULT 0,
      Active_Clients INTEGER DEFAULT 0,
      UNIQUE(Agent_ID, Stat_Date, Period_Type)
    );

    CREATE TABLE IF NOT EXISTS Agent_Commissions (
      Commission_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Agent_ID INTEGER NOT NULL REFERENCES Users(User_ID),
      Order_ID INTEGER REFERENCES Orders(Task_ID),
      Client_ID INTEGER REFERENCES Clients(Client_ID),
      Commission_Amount REAL NOT NULL,
      Commission_Type TEXT CHECK(Commission_Type IN ('order','client_bonus','milestone')),
      Status TEXT DEFAULT 'pending' CHECK(Status IN ('pending','approved','paid','cancelled')),
      Calculated_At DATETIME DEFAULT CURRENT_TIMESTAMP,
      Approved_At DATETIME,
      Approved_By INTEGER REFERENCES Users(User_ID),
      Paid_At DATETIME,
      Notes TEXT
    );

    CREATE TABLE IF NOT EXISTS Agent_Payouts (
      Payout_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Agent_ID INTEGER NOT NULL REFERENCES Users(User_ID),
      Amount REAL NOT NULL,
      Period_Start DATE NOT NULL,
      Period_End DATE NOT NULL,
      Status TEXT DEFAULT 'pending' CHECK(Status IN ('pending','processing','completed','failed')),
      Payment_Method TEXT,
      Transaction_Ref TEXT,
      Requested_At DATETIME DEFAULT CURRENT_TIMESTAMP,
      Processed_At DATETIME,
      Processed_By INTEGER REFERENCES Users(User_ID),
      Notes TEXT
    );

    CREATE TABLE IF NOT EXISTS Agent_Activity_Log (
      Log_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Agent_ID INTEGER NOT NULL REFERENCES Users(User_ID),
      Action TEXT NOT NULL,
      Entity_Type TEXT,
      Entity_ID INTEGER,
      Details TEXT,
      IP_Address TEXT,
      User_Agent TEXT,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Agent_Custom_Designs (
      Custom_Design_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Agent_ID INTEGER NOT NULL REFERENCES Users(User_ID),
      Order_ID INTEGER REFERENCES Orders(Task_ID),
      Name TEXT NOT NULL,
      Description TEXT,
      Image_Path TEXT,
      Thumbnail_Path TEXT,
      Status TEXT DEFAULT 'pending' CHECK(Status IN ('pending','in_progress','completed','cancelled')),
      Designer_ID INTEGER REFERENCES Users(User_ID),
      Notes TEXT,
      Created_At DATETIME DEFAULT CURRENT_TIMESTAMP,
      Updated_At DATETIME DEFAULT CURRENT_TIMESTAMP
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
    db.exec("ALTER TABLE Clients ADD COLUMN Created_By INTEGER");
    console.log('✅ Added Created_By column to Clients');
  } catch (e) {}

  try {
    db.exec("ALTER TABLE Clients ADD COLUMN Agent_Commission REAL DEFAULT 0");
    console.log('✅ Added Agent_Commission column to Clients');
  } catch (e) {}

  try {
    db.exec("ALTER TABLE Clients ADD COLUMN Agent_ID INTEGER REFERENCES Users(User_ID)");
    console.log('✅ Added Agent_ID column to Clients');
  } catch (e) {}

  try {
    db.exec("ALTER TABLE Clients ADD COLUMN Assigned_At DATETIME DEFAULT CURRENT_TIMESTAMP");
    console.log('✅ Added Assigned_At column to Clients');
  } catch (e) {}

  try {
    db.exec("ALTER TABLE Clients ADD COLUMN Source TEXT");
    console.log('✅ Added Source column to Clients');
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
    db.exec("ALTER TABLE Orders ADD COLUMN Agent_Price REAL DEFAULT 0");
    console.log('✅ Added Agent_Price column to Orders');
  } catch (e) {}

  try {
    db.exec("ALTER TABLE Orders ADD COLUMN Agent_Commission REAL DEFAULT 0");
    console.log('✅ Added Agent_Commission column to Orders');
  } catch (e) {}

  try {
    db.exec("ALTER TABLE Orders ADD COLUMN Final_Price REAL DEFAULT 0");
    console.log('✅ Added Final_Price column to Orders');
  } catch (e) {}

  try {
    db.exec("ALTER TABLE Orders ADD COLUMN Agent_Approved_At DATETIME");
    console.log('✅ Added Agent_Approved_At column to Orders');
  } catch (e) {}

  try {
    db.exec("ALTER TABLE Orders ADD COLUMN Agent_Approved_By INTEGER REFERENCES Users(User_ID)");
    console.log('✅ Added Agent_Approved_By column to Orders');
  } catch (e) {}

  try {
    db.exec("ALTER TABLE Agent_Images ADD COLUMN Design_ID INTEGER REFERENCES Designs(Design_ID)");
    console.log('✅ Added Design_ID column to Agent_Images');
  } catch (e) {}

  try {
    db.exec("ALTER TABLE Agent_Custom_Designs ADD COLUMN Designer_ID INTEGER REFERENCES Users(User_ID)");
    console.log('✅ Added Designer_ID column to Agent_Custom_Designs');
  } catch (e) {}

  try {
    // NOTE: sql.js rejects non-constant defaults in ALTER TABLE, so no DEFAULT here
    // (the UPDATE query sets Updated_At = CURRENT_TIMESTAMP explicitly).
    db.exec("ALTER TABLE Agent_Custom_Designs ADD COLUMN Updated_At DATETIME");
    console.log('✅ Added Updated_At column to Agent_Custom_Designs');
  } catch (e) {}

  try {
    db.exec("ALTER TABLE Agent_Custom_Designs ADD COLUMN Notes TEXT");
    console.log('✅ Added Notes column to Agent_Custom_Designs');
  } catch (e) {}

  try {
    const fileCols = db.query("PRAGMA table_info(Order_Files)");
    if (!fileCols.some(c => c.name === 'Label')) { db.exec("ALTER TABLE Order_Files ADD COLUMN Label TEXT DEFAULT ''"); console.log('✅ Added Label column'); }
    if (!fileCols.some(c => c.name === 'File_Type')) { db.exec("ALTER TABLE Order_Files ADD COLUMN File_Type TEXT DEFAULT 'design'"); console.log('✅ Added File_Type column'); }
    if (!fileCols.some(c => c.name === 'Upload_Type')) { db.exec("ALTER TABLE Order_Files ADD COLUMN Upload_Type TEXT DEFAULT 'design' CHECK(Upload_Type IN ('design', 'agent_custom', 'admin_library', 'agent_image', 'agent_shape'))"); console.log('✅ Added Upload_Type column'); }
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
    if (ordersSql.length && !(ordersSql[0].sql || '').includes('بانتظار الموافقة')) {
      db.run('PRAGMA foreign_keys=OFF');
      const orders = db.all("SELECT * FROM Orders");
      db.exec("DROP TABLE IF EXISTS Orders_backup");
      db.exec(`CREATE TABLE Orders_backup (
        Task_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Client_ID INTEGER NOT NULL,
        Designer_ID INTEGER,
        Created_By INTEGER,
        Machine_Type TEXT NOT NULL CHECK(Machine_Type IN ('Laser','Router')),
        Status TEXT NOT NULL DEFAULT 'قيد التصميم' CHECK(Status IN ('قيد التصميم','جاهز للقص','قيد التنفيذ','تم الانتهاء من القص','تم التغليف','تم التسليم','بانتظار الموافقة')),
        Approval_Status TEXT DEFAULT 'approved' CHECK(Approval_Status IN ('pending','approved','rejected')),
        Material_ID INTEGER,
        Material_Qty REAL DEFAULT 0,
        Price REAL DEFAULT 0,
        Cost REAL DEFAULT 0,
        Profit REAL DEFAULT 0,
        Agent_Price REAL DEFAULT 0,
        Agent_Commission REAL DEFAULT 0,
        Final_Price REAL DEFAULT 0,
        Agent_Approved_At DATETIME,
        Agent_Approved_By INTEGER REFERENCES Users(User_ID),
        File_Path TEXT,
        File_Name TEXT,
        Notes TEXT,
        Created_At DATETIME DEFAULT CURRENT_TIMESTAMP,
        Updated_At DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (Client_ID) REFERENCES Clients(Client_ID),
        FOREIGN KEY (Designer_ID) REFERENCES Users(User_ID),
        FOREIGN KEY (Created_By) REFERENCES Users(User_ID),
        FOREIGN KEY (Material_ID) REFERENCES Inventory(Material_ID)
      )`);
      orders.forEach(o => {
        db.run(`INSERT INTO Orders_backup (Task_ID, Client_ID, Designer_ID, Created_By, Machine_Type, Status, Approval_Status, Material_ID, Material_Qty, Price, Cost, Profit, Agent_Price, Agent_Commission, Final_Price, Agent_Approved_At, Agent_Approved_By, File_Path, File_Name, Notes, Created_At, Updated_At)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [o.Task_ID, o.Client_ID, o.Designer_ID, o.Created_By, o.Machine_Type, o.Status, o.Approval_Status || 'approved', o.Material_ID, o.Material_Qty, o.Price, o.Cost, o.Profit, o.Agent_Price || 0, o.Agent_Commission || 0, o.Final_Price || 0, o.Agent_Approved_At || null, o.Agent_Approved_By || null, o.File_Path, o.File_Name, o.Notes, o.Created_At, o.Updated_At]);
      });
      db.exec("DROP TABLE Orders");
      db.exec("ALTER TABLE Orders_backup RENAME TO Orders");
      db.run('PRAGMA foreign_keys=ON');
      console.log('✅ Recreated Orders table with new status and Approval_Status');
    }
  } catch (e) { console.log('⚠️ Orders migration skipped:', e.message); }

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
