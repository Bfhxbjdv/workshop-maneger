-- Preserve earned commissions from agent orders approved before the
-- Agent_Commissions ledger was connected to the Cloudflare workflow.
INSERT INTO Agent_Commissions
  (Agent_ID, Order_ID, Client_ID, Commission_Amount, Commission_Type, Status)
SELECT o.Created_By, o.Task_ID, o.Client_ID, o.Agent_Commission, 'order_total', 'pending'
FROM Orders o
JOIN Users u ON u.User_ID = o.Created_By AND u.Role = 'Agent'
WHERE o.Approval_Status = 'approved'
  AND o.Agent_Commission > 0
  AND NOT EXISTS (SELECT 1 FROM Agent_Commissions ac WHERE ac.Order_ID = o.Task_ID);
