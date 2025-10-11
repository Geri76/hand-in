import { Elysia, redirect, t } from "elysia";
import { PublishService } from "./dns_helper.js";
import { mkdirSync } from "node:fs";
import { html } from "@elysiajs/html";
import page from "./page.html" with { type: "file" };
import already_uploaded from "./already_uploaded.html" with { type: "file" };
import { file, randomUUIDv7 } from "bun";
import figlet from "figlet";
import "colors"
import { LockModes } from "./types.js";
import { Config } from "./config_helper.js";

const DOMAIN = "handin";

const CONFIG = new Config("config.json");

const PROD = true;

const LOCK_MODE = CONFIG.lockMode;

const secrets: string[] = [];

const secretTTL = CONFIG.lockDuration;

try {
  mkdirSync("uploads");
} catch {}

const FINAL_DOMAIN = await PublishService(DOMAIN);

console.log("\x1b[5m" + figlet.textSync(FINAL_DOMAIN + ".local", {
  font: "Colossal"
}).green + "\x1b[25m");

console.log("http://" + FINAL_DOMAIN + ".local\n");

console.log("Configuration:");
console.log(`  Lock Mode: ${LOCK_MODE}`);
if (LOCK_MODE == LockModes.COOKIE)
  console.log(`  Lock Duration: ${secretTTL}s\n`);

new Elysia()
  .onRequest((data) => {
    if (PROD && data.request.headers.get("host") != FINAL_DOMAIN + ".local") return redirect("http://" + FINAL_DOMAIN + ".local");
  })
  .use(html())
  .get(
    "/",
    async ({ server, cookie, request }) => {
      switch (LOCK_MODE) {
        case LockModes.COOKIE:
          if (secrets.includes(cookie.secret.value??"")) return file(already_uploaded.toString());
          break;
        case LockModes.IP:
          if (secrets.includes(server?.requestIP(request)?.address.toString()??"")) return file(already_uploaded.toString());
          break;
        default:
          break;
      }

      return file(page.toString());
    },
    {
      cookie: t.Cookie({
        secret: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/upload",
    async ({ cookie, body, server, request }) => {
      const f: File = body.file;

      await Bun.write("uploads/" + f.name, await f.bytes());

      switch (LOCK_MODE) {
        case LockModes.COOKIE:
          if (secrets.includes(cookie.secret.value??"")) return redirect("/");
          break;
        case LockModes.IP:
          if (secrets.includes(server?.requestIP(request)?.address.toString()??"")) return redirect("/");
          break;
        default:
          break;
      }
      
      if (LOCK_MODE == LockModes.COOKIE) {
        const uuid = randomUUIDv7("base64", Date.now());
        cookie.secret.set({ value: uuid, expires: new Date(Date.now()+secretTTL*1000) });
        secrets.push(uuid);
      } else {
        secrets.push(server?.requestIP(request)?.address.toString()??"");
      }

      console.log(`Received file: ${f.name} (${f.size} bytes) from ${server?.requestIP(request)?.address.toString()}`);

      return redirect("/");
    },
    {
      cookie: t.Cookie({
        secret: t.Optional(t.String()),
      }),
      body: t.Object({
        file: t.File(),
      }),
    }
  )
  .listen(80);
