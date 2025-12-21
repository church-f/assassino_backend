function cookieOpts({ httpOnly }) {
  const isProd = process.env.NODE_ENV === "production";

  return {
    httpOnly,
    secure: isProd,      // true solo in HTTPS
    sameSite: "lax",
    path: "/"
  };
}

module.exports = { cookieOpts };
