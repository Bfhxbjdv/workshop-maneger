const db = require('../database/connection');

function requireAuth(roles = []) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(401).json({ error: 'غير مصرح', login: true });
      }
      return res.redirect('/login');
    }
    if (roles.length > 0 && !roles.includes(req.session.role)) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(403).json({ error: 'لا تملك الصلاحية' });
      }
      return res.status(403).send('لا تملك الصلاحية');
    }
    next();
  };
}

module.exports = { requireAuth };
