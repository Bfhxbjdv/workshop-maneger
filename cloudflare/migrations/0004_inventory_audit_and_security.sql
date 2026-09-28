-- Auditable inventory movements.  Quantities remain on Inventory for fast reads,
-- while this append-only ledger explains every stock change.
CREATE TABLE IF NOT EXISTS Inventory_Movements (
  Movement_ID INTEGER PRIMARY KEY AUTOINCREMENT,
  Material_ID INTEGER NOT NULL,
  Task_ID INTEGER,
  User_ID INTEGER,
  Movement_Type TEXT NOT NULL,
  Quantity REAL NOT NULL,
  Quantity_Before REAL,
  Quantity_After REAL,
  Notes TEXT DEFAULT '',
  Created_At TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (Material_ID) REFERENCES Inventory(Material_ID),
  FOREIGN KEY (Task_ID) REFERENCES Orders(Task_ID),
  FOREIGN KEY (User_ID) REFERENCES Users(User_ID)
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_material
  ON Inventory_Movements(Material_ID, Created_At DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_task
  ON Inventory_Movements(Task_ID, Created_At DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_action
  ON System_Logs(Action, Created_At DESC);
