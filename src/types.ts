export enum LockModes {
  COOKIE = "COOKIE",
  IP = "IP",
}

export type Secret = {
  value: string;
  fileName: string;
};
