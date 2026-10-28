// Einzeilige Logs mit Zeitstempel, z. B.:
// 2026-10-28T10:00:00.000Z INFO GET /api/session status=200 ms=12 user=1a2b3c4d
// Beim Hoster landen sie im normalen Server-Log. Passwörter und Tokens werden nie geloggt.

const formatValue = (value) =>
  typeof value === "string" && /^[^\s"=]+$/.test(value) ? value : JSON.stringify(value);

const log = (level, message, fields = {}) => {
  const extras = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(" ");
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${extras ? ` ${extras}` : ""}`;

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
};

module.exports = { log };
