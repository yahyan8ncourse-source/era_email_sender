const tls = require("tls");

function readResponse(socket, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("SMTP timeout"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
    }

    function onError(err) {
      cleanup();
      reject(err);
    }

    function onData(chunk) {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n").filter((line) => line.length > 0);
      const last = lines[lines.length - 1];
      if (last && last.length >= 4 && last[3] === " ") {
        cleanup();
        resolve(lines.join("\r\n"));
      }
    }

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function command(socket, cmd, code) {
  if (cmd) socket.write(`${cmd}\r\n`);
  const response = await readResponse(socket);
  const got = Number(response.slice(0, 3));
  if (code && got !== code) {
    throw new Error(response.trim() || `SMTP error ${got}`);
  }
  return response;
}

function encodeHeader(value) {
  return value.replace(/\r?\n/g, " ").trim();
}

function buildMessage({ from, fromName, to, subject, text, html }) {
  const boundary = `era-${Date.now()}`;
  const headers = [
    `From: "${encodeHeader(fromName)}" <${from}>`,
    `To: ${to}`,
    `Reply-To: ${from}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    text,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
    `--${boundary}--`,
    "",
  ];
  return `${headers.join("\r\n")}\r\n.`;
}

function sendMail({ host, port, user, pass, from, fromName, to, subject, text, html }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: true },
      async () => {
        try {
          await readResponse(socket);
          await command(socket, `EHLO ${host}`, 250);
          await command(socket, "AUTH LOGIN", 334);
          await command(socket, Buffer.from(user, "utf8").toString("base64"), 334);
          await command(socket, Buffer.from(pass, "utf8").toString("base64"), 235);
          await command(socket, `MAIL FROM:<${from}>`, 250);
          await command(socket, `RCPT TO:<${to}>`, 250);
          await command(socket, "DATA", 354);
          const body = buildMessage({ from, fromName, to, subject, text, html });
          socket.write(`${body}\r\n`);
          const sent = await readResponse(socket);
          if (!sent.startsWith("250")) {
            throw new Error(sent.trim() || "Send failed");
          }
          await command(socket, "QUIT", 221);
          socket.end();
          resolve({ messageId: `native-${Date.now()}`, response: sent.trim() });
        } catch (err) {
          socket.destroy();
          reject(err);
        }
      }
    );

    socket.on("error", reject);
  });
}

module.exports = { sendMail };
