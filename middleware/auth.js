const db = require('../database/connection');

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
    if (req.session.role === 'Admin') return next();
    if (req.session.role === 'Custom') {
      const user = db.get("SELECT Permissions FROM Users WHERE User_ID=?", [req.session.userId]);
      if (user) {
        try {
          const perms = JSON.parse(user.Permissions || '{}');
          if (perms[permission]) return next();
        } catch {}
      }
    }
    const standardRoles = {
      'Designer': ['orders', 'clients', 'inventory', 'invoices'],
      'Laser_Op': ['orders'],
      'Router_Op': ['orders']
    };
    const allowed = standardRoles[req.session.role] || [];
    if (allowed.includes(permission)) return next();
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(403).json({ error: 'لا تملك الصلاحية' });
    }
    return res.status(403).send('لا تملك الصلاحية');
  };
}

module.exports = { requireAuth, requirePermission };
