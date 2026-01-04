import { Elysia, redirect, t } from "elysia";
import { PublishService } from "./dns_helper.js";
import { mkdirSync } from "node:fs";
import { html } from "@elysiajs/html";
import { file, randomUUIDv7 } from "bun";
import "colors";
import { LockModes } from "./types.js";
import { Config } from "./config_helper.js";
import { already_uploaded, page } from "./page_helper.js";
import { COLORS } from "./contants.js";
import { BUN_VERSION, ELYSIA_VERSION, HANDIN_VERSION } from "./version_helper.js";
import { file_helper } from "./file_helper.js";

const DOMAIN = "handin";

const CONFIG = new Config("config.json");

const PROD = Bun.env.NODE_ENV === "development" ? false : true;

const LOCK_MODE = CONFIG.lockMode;

const SECRETS: string[] = [];

const SECRET_TTL = CONFIG.lockDuration;

try {
  mkdirSync("uploads");
} catch {}

const FINAL_DOMAIN = await PublishService(DOMAIN);

console.log(COLORS.GREEN + "http://" + COLORS.RED + FINAL_DOMAIN + ".local\n" + COLORS.RESET);

console.log(COLORS.BLUE + "Beállítások:" + COLORS.RESET);
console.log(`${COLORS.YELLOW}  Zárolási mód: ${COLORS.RED + LOCK_MODE}${COLORS.RESET}`);
if (LOCK_MODE == LockModes.COOKIE)
  console.log(`${COLORS.YELLOW}  Zárolási időtartam: ${COLORS.RED + SECRET_TTL}s\n${COLORS.RESET}`);

new Elysia()
  .onRequest((data) => {
    if (PROD && data.request.headers.get("host") != FINAL_DOMAIN + ".local")
      return redirect("http://" + FINAL_DOMAIN + ".local");
  })
  .use(html())
  .get(
    "/",
    async ({ server, cookie, request }) => {
      switch (LOCK_MODE) {
        case LockModes.COOKIE:
          if (SECRETS.includes(cookie.secret.value ?? "")) return file(already_uploaded.toString());
          break;
        case LockModes.IP:
          if (SECRETS.includes(server?.requestIP(request)?.address.toString() ?? ""))
            return file(already_uploaded.toString());
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
          if (SECRETS.includes(cookie.secret.value ?? "")) return redirect("/");
          break;
        case LockModes.IP:
          if (SECRETS.includes(server?.requestIP(request)?.address.toString() ?? "")) return redirect("/");
          break;
        default:
          break;
      }

      if (LOCK_MODE == LockModes.COOKIE) {
        const uuid = randomUUIDv7("base64", Date.now());
        cookie.secret.set({ value: uuid, expires: new Date(Date.now() + SECRET_TTL * 1000) });
        SECRETS.push(uuid);
      } else {
        SECRETS.push(server?.requestIP(request)?.address.toString() ?? "");
      }

      console.log(
        `${COLORS.YELLOW}\nFájl feltöltve: ${COLORS.RED}${f.name} (${COLORS.GREEN}${f.size} bájt${COLORS.RED}) ${
          COLORS.BLUE + server?.requestIP(request)?.address.toString() + COLORS.RESET
        }`
      );

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
  .get("/stats", ({ params }) => {
    return { BUN_VERSION, ELYSIA_VERSION, HANDIN_VERSION };
  })
  .get("/health", () => "OK")
  .get("/static/:file_name", ({ params }) => {
    switch (params.file_name) {
      case "cat.webp":
        return file(file_helper.catWebpUrl);
      default:
        return "N/A";
    }
  })

  .listen(80);
