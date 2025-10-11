import { Elysia, redirect, t } from "elysia";
import { PublishService } from "./dns_helper.js";
import { mkdirSync } from "node:fs";
import { html } from "@elysiajs/html";
import page from "./page.html" with { type: "file" };
import already_uploaded from "./already_uploaded.html" with { type: "file" };
import { file, randomUUIDv7 } from "bun";
import figlet from "figlet";
import "colors"

const DOMAIN = "handin";

const PROD = true;

enum LockModes {
  COOKIE,
  IP
};

const LOCK_MODE = LockModes.IP as LockModes;

const secrets: string[] = [];

const secretTTL = 5 * 60; // 5 Minutes

try {
  mkdirSync("uploads");
} catch {}

const FINAL_DOMAIN = await PublishService(DOMAIN);

console.log("\x1b[5m" + figlet.textSync(FINAL_DOMAIN + ".local", {
  font: "Colossal"
}).green + "\x1b[25m");

console.log("http://" + FINAL_DOMAIN + ".local\n");

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
