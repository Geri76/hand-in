import { Elysia, redirect, t } from "elysia";
import { PublishService } from "./dns_helper.js";
import { mkdirSync } from "node:fs";
import { html } from "@elysiajs/html";
import { file, randomUUIDv7 } from "bun";
import { LockModes, Secret } from "./types.js";
import { Config } from "./config_helper.js";
import { already_uploaded, index, index_confirm } from "./page_helper.js";
import { COLORS } from "./contants.js";
import { BUN_VERSION, ELYSIA_VERSION, HANDIN_VERSION } from "./version_helper.js";
import { file_helper } from "./file_helper.js";
import { checkForUpdate } from "./utils.js";
import { REPLACER_SCRIPT } from "./update_helper.js";
import { spawn } from "child_process";
import { spawnSync } from "node:child_process";

const DOMAIN = "handin";

const CONFIG = new Config("config.json");

const PROD = Bun.env.NODE_ENV === "development" ? false : true;

const LOCK_MODE = CONFIG.lockMode;

const SECRETS: Secret[] = [];

const SECRET_TTL = CONFIG.lockDuration;

const INDEX_PAGE = CONFIG.confirmSubmission ? index_confirm : index;

try {
  mkdirSync("uploads");
} catch {}

const FINAL_DOMAIN = await PublishService(DOMAIN);

const LATEST_VERSION = await checkForUpdate();
if (LATEST_VERSION) {
  console.log(
    `${COLORS.YELLOW}Új verzió érhető el: ${COLORS.BLUE}${LATEST_VERSION}${COLORS.YELLOW} (jelenlegi: ${COLORS.RED}${HANDIN_VERSION}${COLORS.YELLOW})`
  );
  console.log(`Nyomd meg az "${COLORS.BLUE}U${COLORS.YELLOW}" billentyűt a frissítéshez.\n`);
}

console.log(COLORS.GREEN + "http://" + COLORS.RED + FINAL_DOMAIN + ".local\n" + COLORS.RESET);

console.log(COLORS.BLUE + "Beállítások:" + COLORS.RESET);
console.log(
  COLORS.YELLOW + "  Feltöltés Jóváhagyás: " + COLORS.RED + (CONFIG.confirmSubmission ? "Igen" : "Nem") + COLORS.RESET
);

console.log(`${COLORS.YELLOW}  Zárolási mód: ${COLORS.RED + LOCK_MODE}${COLORS.RESET}`);
if (LOCK_MODE == LockModes.COOKIE)
  console.log(`${COLORS.YELLOW}  Zárolási időtartam: ${COLORS.RED + SECRET_TTL}s\n${COLORS.RESET}`);

// Updater

let alreadyUpdating = false;

process.stdin.setRawMode(true);
process.stdin.on("data", async (e) => {
  if (e[0] == 3) {
    console.log(COLORS.RED + "\nKilépés..." + COLORS.RESET);
    process.exit();
  }

  if (e[0] == 117 && !alreadyUpdating && LATEST_VERSION) {
    alreadyUpdating = true;
    console.log(COLORS.YELLOW + "\nFrissítés indítása..." + COLORS.RESET);

    const url = `https://github.com/geri76/hand-in/releases/latest/download/handin.exe`;
    const response = await fetch(url);

    if (!response.ok || !response.body) throw new Error(`Letöltés sikertelen: HTTP ${response.status}`);

    const total = Number(response.headers.get("content-length") ?? "0");
    const reader = response.body.getReader();
    const sink = Bun.file("handin.exe.new").writer();

    let received = 0;
    const startedAt = Date.now();
    let lastRenderAt = 0;

    const render = (final = false) => {
      const now = Date.now();
      if (!final && now - lastRenderAt < 100) return;
      lastRenderAt = now;

      const elapsedSec = Math.max(0.001, (now - startedAt) / 1000);
      const bps = received / elapsedSec;

      const speed =
        bps > 1024 * 1024
          ? `${(bps / (1024 * 1024)).toFixed(2)} MB/s`
          : bps > 1024
          ? `${(bps / 1024).toFixed(2)} KB/s`
          : `${bps.toFixed(0)} B/s`;

      if (total > 0) {
        const pct = Math.min(100, (received / total) * 100);
        process.stdout.write(`\r${COLORS.BLUE}Letöltés: ${COLORS.RED}${pct.toFixed(1)}%${COLORS.YELLOW} (${speed})`);
      } else {
        process.stdout.write(`\r${COLORS.BLUE}Letöltés: ${COLORS.RED}${received}${COLORS.YELLOW} bájt (${speed})`);
      }
    };

    render();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        sink.write(value);
        render();
      }
    }

    await sink.end();
    render(true);
    process.stdout.write("\n");

    console.log(COLORS.GREEN + "\nSikeres frissítés." + COLORS.RESET);

    const child = spawn("cmd", ["/c", "pwsh", "-c", REPLACER_SCRIPT], {
      detached: true,
    });

    child.unref();

    process.exit();
  }
});

// Main program

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
          if (SECRETS.some((secret) => secret.value === (cookie.secret.value ?? "")))
            return file(already_uploaded.toString());
          break;
        case LockModes.IP:
          if (SECRETS.some((secret) => secret.value === (server?.requestIP(request)?.address?.toString() ?? "")))
            return file(already_uploaded.toString());
          break;
        default:
          break;
      }

      return file(INDEX_PAGE.toString());
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

      let path = "uploads/" + f.name;
      let extension = "";
      if (f.name.includes(".")) {
        extension = f.name.split(".").pop() ?? "";
      }
      let fileNameWithoutExtension = f.name;
      if (extension !== "") {
        fileNameWithoutExtension = f.name.substring(0, f.name.length - extension.length - 1);
      }

      const ip = server?.requestIP(request)?.address.toString().replace(/[:.]/g, "_") ?? "unknown";
      path = `uploads/${fileNameWithoutExtension}_${ip}${extension ? "." + extension : ""}`;

      await Bun.write(path, await f.bytes());

      switch (LOCK_MODE) {
        case LockModes.COOKIE:
          if (SECRETS.some((secret) => secret.value === (cookie.secret.value ?? ""))) return redirect("/");
          break;
        case LockModes.IP:
          if (SECRETS.some((secret) => secret.value === (server?.requestIP(request)?.address.toString() ?? "")))
            return redirect("/");
          break;
        default:
          break;
      }

      if (LOCK_MODE == LockModes.COOKIE) {
        const uuid = randomUUIDv7("base64", Date.now());
        cookie.secret.set({
          value: uuid,
          expires: new Date(Date.now() + SECRET_TTL * 1000),
        });
        SECRETS.push({ value: uuid, fileName: f.name } as Secret);
      } else {
        SECRETS.push({
          value: server?.requestIP(request)?.address.toString() ?? "",
          fileName: f.name,
        } as Secret);
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
  .get(
    "/stats",
    ({ cookie, server, request }) => {
      let I_UPLOADED = undefined;

      if (LOCK_MODE == LockModes.COOKIE) {
        I_UPLOADED = SECRETS.filter((s) => s.value === cookie.secret.value).map((s) => s.fileName);
      } else {
        I_UPLOADED = SECRETS.filter((s) => s.value === server?.requestIP(request)?.address.toString());
      }

      return { BUN_VERSION, ELYSIA_VERSION, HANDIN_VERSION, I_UPLOADED };
    },
    {
      cookie: t.Cookie({
        secret: t.Optional(t.String()),
      }),
    }
  )
  .get("/health", () => "OK")
  .get("/static/already_uploaded", () => {
    const options = file_helper.already_uploaded;
    const randomIndex = Math.floor(Math.random() * options.length);
    return file(options[randomIndex]);
  })
  .get("/static/icon", () => {
    return file(file_helper.icons.icon512Url);
  })
  .get("/static/github", () => {
    return file(file_helper.icons.githubIconUrl);
  })
  .get("/static/arrow", () => {
    return file(file_helper.icons.arrowIconUrl);
  })
  .listen(80);
