const crypto = require("crypto");
const { cookieOpts } = require("./cookies");

function setCsrfCookie(req, res) {
  const token = crypto.randomBytes(32).toString("hex");

  res.cookie(process.env.CSRF_COOKIE || "csrf", token, {
    ...cookieOpts({ httpOnly: false }),
    maxAge: 1000 * 60 * 60 // 1 ora
  });

  return token;
}

function requireCsrf(req, res, next) {
  const cookieToken = req.cookies?.[process.env.CSRF_COOKIE || "csrf"];
  const headerToken = req.headers["x-csrf-token"];


  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: "CSRF check failed" });
  }

  next();
}

module.exports = { setCsrfCookie, requireCsrf };
