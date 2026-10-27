import { PIXEL_ICON_NAMES, type PixelIconName } from "./PixelIcon";

/**
 * Legacy emoji -> pixel icon. The database still holds emoji in `agents.avatar_emoji`,
 * `departments.icon` and `office_pack_departments.icon` (stock seeds, older rows); new rows
 * store a PixelIconName directly. Keys are written as code-point escapes so this source file
 * stays emoji-free (see no-emoji.test.ts); the trailing comment names each glyph.
 * Keys carry no U+FE0F variation selector: lookups strip it.
 */
const EMOJI_TO_ICON = new Map<string, PixelIconName>([
  ["\u{1F3E2}", "office"], // office building
  ["\u{1F3F0}", "office"], // castle
  ["\u{1F3D7}", "office"], // construction
  ["\u{1F465}", "team"], // people
  ["\u{1F4DA}", "library"], // books
  ["\u{1F4CA}", "planning"], // bar chart (stock planning dept)
  ["\u{1F4C8}", "chart"], // chart increasing
  ["\u{1F4CB}", "tasks"], // clipboard
  ["\u{1F500}", "prs"], // shuffle arrows
  ["\u{2699}", "operations"], // gear (stock operations dept)
  ["\u{1F4E2}", "announcement"], // loudspeaker
  ["\u{1F4E3}", "announcement"], // megaphone
  ["\u{1F9ED}", "decision"], // compass
  ["\u{23F3}", "pending"], // hourglass
  ["\u{23F1}", "clock"], // stopwatch
  ["\u{23F0}", "clock"], // alarm clock
  ["\u{1F514}", "bell"], // bell
  ["\u{1F4AC}", "chat"], // speech balloon
  ["\u{1F5E3}", "chat"], // speaking head
  ["\u{1F44B}", "user"], // waving hand
  ["\u{1F50D}", "qa"], // magnifier left (stock QA dept)
  ["\u{1F50E}", "search"], // magnifier right
  ["\u{270F}", "edit"], // pencil
  ["\u{270D}", "edit"], // writing hand
  ["\u{1F58B}", "edit"], // fountain pen
  ["\u{1F4DD}", "edit"], // memo
  ["\u{1F5D1}", "trash"], // wastebasket
  ["\u{1F504}", "refresh"], // arrows cycle
  ["\u{1F517}", "link"], // link
  ["\u{1F4CE}", "link"], // paperclip
  ["\u{1F4CC}", "pin"], // pushpin
  ["\u{1F3AF}", "flag"], // target
  ["\u{1F6A9}", "flag"], // flag
  ["\u{1F4C1}", "folder"], // folder
  ["\u{1F5C2}", "folder"], // card dividers
  ["\u{1F4E6}", "operations"], // package
  ["\u{1F4C4}", "file"], // page
  ["\u{1F9FE}", "report"], // receipt
  ["\u{1F4DC}", "file"], // scroll
  ["\u{1F4D0}", "design"], // triangle ruler
  ["\u{1F512}", "lock"], // lock
  ["\u{1F510}", "lock"], // lock with key
  ["\u{1F513}", "unlock"], // open lock
  ["\u{1F511}", "key"], // key
  ["\u{1F50C}", "link"], // plug
  ["\u{1F441}", "eye"], // eye
  ["\u{1F648}", "eye"], // see-no-evil
  ["\u{26A0}", "warning"], // warning
  ["\u{1F6AB}", "error"], // prohibited
  ["\u{274C}", "cross"], // cross mark
  ["\u{2715}", "cross"], // multiply x
  ["\u{2705}", "check"], // check box
  ["\u{2713}", "check"], // check mark
  ["\u{2611}", "check"], // ballot box with check
  ["\u{2753}", "info"], // question
  ["\u{25B6}", "play"], // play
  ["\u{23F8}", "pause"], // pause
  ["\u{23F9}", "stop"], // stop
  ["\u{1F4E5}", "download"], // inbox tray
  ["\u{1F91D}", "meeting"], // handshake
  ["\u{1F4BC}", "team"], // briefcase
  ["\u{1F5BC}", "image"], // framed picture
  ["\u{1F4F7}", "camera"], // camera
  ["\u{1F3AC}", "video"], // clapper
  ["\u{1F4FD}", "video"], // projector
  ["\u{1F39E}", "video"], // film frames
  ["\u{1F399}", "music"], // microphone
  ["\u{1F3B5}", "music"], // note
  ["\u{1F4BB}", "dev"], // laptop (stock dev dept)
  ["\u{1F5A5}", "terminal"], // desktop computer
  ["\u{1F4BE}", "file"], // floppy
  ["\u{1F4F1}", "phone"], // mobile phone
  ["\u{1F4E1}", "intel"], // satellite antenna
  ["\u{1F5FA}", "intel"], // world map
  ["\u{1F30C}", "globe"], // milky way
  ["\u{1F30D}", "globe"], // globe
  ["\u{1F6E1}", "shield"], // shield
  ["\u{1F527}", "wrench"], // wrench
  ["\u{1F529}", "wrench"], // nut and bolt
  ["\u{1F6E0}", "workbench"], // hammer and wrench
  ["\u{1F528}", "wrench"], // hammer
  ["\u{1F985}", "scope"], // eagle
  ["\u{1F52C}", "test"], // microscope
  ["\u{1F9EA}", "test"], // test tube
  ["\u{1FA7A}", "medstation"], // stethoscope
  ["\u{1F489}", "medkit"], // syringe
  ["\u{1FA79}", "medkit"], // bandage
  ["\u{1F3A8}", "design"], // palette
  ["\u{1FA96}", "camo"], // helmet
  ["\u{1F9F5}", "camo"], // thread
  ["\u{1F3AD}", "palette"], // performing arts
  ["\u{1FAB6}", "edit"], // feather
  ["\u{1F6A8}", "security"], // police light
  ["\u{26A1}", "bolt"], // high voltage
  ["\u{26FD}", "generator"], // fuel pump
  ["\u{1F9F1}", "workbench"], // brick
  ["\u{1F9E0}", "brain"], // brain
  ["\u{1F578}", "link"], // spider web
  ["\u{1F4D8}", "book"], // blue book
  ["\u{1F4D9}", "book"], // orange book
  ["\u{1F4D6}", "book"], // open book
  ["\u{1F4D3}", "book"], // notebook
  ["\u{1F393}", "graduation"], // graduation cap
  ["\u{1F9D1}\u{200D}\u{1F3EB}", "graduation"], // teacher
  ["\u{1F4A1}", "lightbulb"], // light bulb
  ["\u{1F9E9}", "code"], // puzzle piece
  ["\u{1F916}", "robot"], // robot
  ["\u{1F464}", "user"], // bust
  ["\u{1F64B}", "you"], // raising hand
  ["\u{1F419}", "github"], // octopus
  ["\u{1F9D1}\u{200D}\u{1F4BC}", "ceo"], // office worker
  ["\u{1F451}", "crown"], // crown
  ["\u{1F9D1}\u{200D}\u{1F4BB}", "dev"], // technologist
  ["\u{1F469}\u{200D}\u{1F4BB}", "dev"], // woman technologist
  ["\u{1F468}\u{200D}\u{1F52C}", "test"], // scientist
  ["\u{1F469}\u{200D}\u{1F3A8}", "design"], // artist
  ["\u{1F9B8}", "star"], // superhero
  ["\u{1F60A}", "heart"], // smile
  ["\u{1F60E}", "star"], // sunglasses
  ["\u{1F913}", "brain"], // nerd
  ["\u{1F98A}", "heart"], // fox
  ["\u{1F431}", "heart"], // cat
  ["\u{1F436}", "heart"], // dog
  ["\u{1F43B}", "heart"], // bear
  ["\u{1F43C}", "heart"], // panda
  ["\u{1FA77}", "heart"], // pink heart
  ["\u{1F680}", "rocket"], // rocket
  ["\u{1F525}", "fire"], // fire
  ["\u{1F48E}", "gem"], // gem
  ["\u{1F4A0}", "gem"], // diamond with dot
  ["\u{1F3C6}", "trophy"], // trophy
  ["\u{1F947}", "medal"], // gold medal
  ["\u{1F948}", "medal"], // silver medal
  ["\u{1F949}", "medal"], // bronze medal
  ["\u{2694}", "medal"], // crossed swords
  ["\u{1F3AE}", "play"], // game controller
  ["\u{1F31F}", "star"], // glowing star
  ["\u{2B50}", "star"], // star
  ["\u{2728}", "sparkle"], // sparkles
  ["\u{1F4AB}", "sparkle"], // dizzy
  ["\u{1F308}", "sparkle"], // rainbow
  ["\u{1F30A}", "globe"], // wave
  ["\u{1F338}", "heart"], // blossom
  ["\u{1F340}", "star"], // clover
  ["\u{1F319}", "moon"], // crescent moon
  ["\u{2600}", "sun"], // sun
  ["\u{2744}", "sparkle"], // snowflake
  ["\u{1F535}", "dot"], // blue circle
  ["\u{1F7E2}", "dot"], // green circle
  ["\u{1F7E1}", "dot"], // yellow circle
  ["\u{1F534}", "dot"], // red circle
  ["\u{1F7E3}", "dot"], // purple circle
  ["\u{1F7E0}", "dot"], // orange circle
  ["\u{26AA}", "dot"], // white circle
  ["\u{2615}", "coffee"], // coffee
  ["\u{1F96B}", "coffee"], // canned food
  ["\u{1F4A4}", "pause"], // zzz
  ["\u{1FAB4}", "break"], // potted plant
  ["\u{1F4B8}", "spend"], // money with wings
  ["\u{1F4B0}", "money"], // money bag
  ["\u{1F41B}", "bug"], // bug
  ["\u{1F389}", "sparkle"], // party popper
  ["\u{1F4C5}", "calendar"], // calendar
  ["\u{1F3F7}", "flag"], // label
]);

const ICON_NAMES: ReadonlySet<string> = new Set(PIXEL_ICON_NAMES);

export function isPixelIconName(value: unknown): value is PixelIconName {
  return typeof value === "string" && ICON_NAMES.has(value);
}

/** Resolves a stored icon value (legacy emoji or PixelIconName) to a PixelIconName. */
export function iconFor(value: string | null | undefined, fallback: PixelIconName): PixelIconName {
  const raw = value?.trim();
  if (!raw) return fallback;
  if (isPixelIconName(raw)) return raw;
  const key = raw.replace(/️/g, "");
  return EMOJI_TO_ICON.get(key) ?? fallback;
}
