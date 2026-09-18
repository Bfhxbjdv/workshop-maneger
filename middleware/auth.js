const db = require('../database/connection');

function hasPermission(req, permission) {
  if (!req.session?.userId) return false;
  if (req.session.role === 'Admin') return true;
  if (req.session.role === 'Custom') {
    const user = db.get("SELECT Permissions FROM Users WHERE User_ID=?", [req.session.userId]);
    try { return !!JSON.parse(user?.Permissions || '{}')[permission]; } catch { return false; }
  }
  const standardRoles = {
    Designer: ['orders', 'clients', 'inventory', 'invoices'],
    Laser_Op: ['orders'],
    Router_Op: ['orders']
  };
  return (standardRoles[req.session.role] || []).includes(permission);
}

// Centralize row-level access to orders. Page-level permissions alone are not
// sufficient because designers and machine operators must not access each
// other's work by guessing an API identifier.
function canAccessOrder(req, order) {
  if (!order || !req.session?.userId) return false;
  if (req.session.role === 'Admin') return true;
  if (req.session.role === 'Custom') return hasPermission(req, 'orders');
  if (req.session.role === 'Designer') return Number(order.Designer_ID) === Number(req.session.userId);
  if (req.session.role === 'Laser_Op') return order.Machine_Type === 'Laser';
  if (req.session.role === 'Router_Op') return order.Machine_Type === 'Router';
  return false;
}

function orderScope(req, alias = 'o') {
  if (req.session.role === 'Admin' || (req.session.role === 'Custom' && hasPermission(req, 'orders'))) {
    return { sql: '1=1', params: [] };
  }
  if (req.session.role === 'Designer') return { sql: `${alias}.Designer_ID = ?`, params: [req.session.userId] };
  if (req.session.role === 'Laser_Op') return { sql: `${alias}.Machine_Type = 'Laser'`, params: [] };
  if (req.session.role === 'Router_Op') return { sql: `${alias}.Machine_Type = 'Router'`, params: [] };
  return { sql: '1=0', params: [] };
}

function requireAuth(roles = []) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(401).json({ error: 'غير مصرح', login: true });
      }
      return res.redirect('/login');
    }
    if (roles.length > 0) {
      const role = req.session.role;
      if (role === 'Admin') return next();
      if (roles.includes(role)) return next();
      if (role === 'Custom') {
        const user = db.get("SELECT Permissions FROM Users WHERE User_ID=?", [req.session.userId]);
        if (user) {
          try {
            const perms = JSON.parse(user.Permissions || '{}');
            const pageMap = {
              'clients': ['clients'],
              'orders': ['orders'],
              'inventory': ['inventory'],
              'invoices': ['invoices'],
              'expenses': ['expenses'],
              'admin': ['admin'],
              'users': ['users']
            };
            const requiredPerms = roles.flatMap(r => pageMap[r] || []);
            if (requiredPerms.some(p => perms[p])) return next();
          } catch {}
        }
      }
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(403).json({ error: 'لا تملك الصلاحية' });
      }
      return res.status(403).send('لا تملك الصلاحية');
    }
    next();
  };
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(401).json({ error: 'غير مصرح', login: true });
      }
      return res.redirect('/login');
    }
    if (hasPermission(req, permission)) return next();
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(403).json({ error: 'لا تملك الصلاحية' });
    }
    return res.status(403).send('لا تملك الصلاحية');
  };
}

module.exports = { requireAuth, requirePermission, hasPermission, canAccessOrder, orderScope };
