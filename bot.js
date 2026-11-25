import { Telegraf } from "telegraf";
import dotenv from "dotenv";

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);

const sessions = new Map();
const polls = new Map();

// Экранирование HTML
function escapeHTML(text) {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

// Запрос ссылки для текущего варианта
function askForLink(ctx, session) {
  const index = session.linkIndex;
  const option = session.options[index];

  return ctx.reply(
    `Вариант ${index + 1}: ${option.text}\n\n` +
      "Отправь ссылку для этого варианта.\n" +
      "Если ссылки нет, напиши /skip",
  );
}

// Завершение создания и предварительный просмотр
async function finishPoll(ctx, session) {
  const pollId = Date.now().toString();

  polls.set(pollId, {
    title: session.title,
    options: session.options,
  });

  sessions.delete(ctx.from.id);

  let preview = `<b>${escapeHTML(session.title)}</b>\n\n`;

  session.options.forEach((option, index) => {
    preview += `${index + 1}. ${escapeHTML(option.text)}\n`;
    preview += option.url
      ? "   🔗 Ссылка прикреплена\n\n"
      : "   Без ссылки\n\n";
  });

  const buttons = session.options
    .map((option, index) => {
      if (!option.url) return null;

      return [
        {
          text: `🔗 ${option.text}`,
          url: option.url,
        },
      ];
    })
    .filter(Boolean);

  preview += "Голосование сохранено как черновик!";

  await ctx.reply(preview, {
    parse_mode: "HTML",
    ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

// Старт
bot.start((ctx) => {
  ctx.reply(
    "Привет! Я бот для голосований.\n\n" +
      "/create — создать голосование\n" +
      "/cancel — отменить создание",
  );
});

// Создание
bot.command("create", (ctx) => {
  if (ctx.chat.type !== "private") {
    return ctx.reply("Создавай голосования в личных сообщениях со мной.");
  }

  sessions.set(ctx.from.id, {
    step: "title",
    title: "",
    options: [],
    linkIndex: 0,
  });

  ctx.reply("Шаг 1/3\n\nНапиши название голосования:");
});

// Отмена
bot.command("cancel", (ctx) => {
  sessions.delete(ctx.from.id);
  ctx.reply("Создание голосования отменено.");
});

// Пропуск ссылки
bot.command("skip", async (ctx) => {
  const session = sessions.get(ctx.from.id);

  if (!session || session.step !== "link") {
    return ctx.reply("Сейчас нечего пропускать.");
  }

  session.options[session.linkIndex].url = null;
  session.linkIndex++;

  if (session.linkIndex < session.options.length) {
    return askForLink(ctx, session);
  }

  await finishPoll(ctx, session);
});

// Обработка текста
bot.on("text", async (ctx) => {
  const session = sessions.get(ctx.from.id);

  if (!session) return;

  const message = ctx.message.text.trim();

  // Название
  if (session.step === "title") {
    if (message.length < 3 || message.length > 200) {
      return ctx.reply("Название должно содержать от 3 до 200 символов.");
    }

    session.title = message;
    session.step = "options";

    return ctx.reply(
      "Шаг 2/3\n\n" +
        "Напиши варианты ответов.\n" +
        "Каждый вариант с новой строки.\n\n" +
        "Пример:\n" +
        "Вариант 1\n" +
        "Вариант 2\n" +
        "Вариант 3",
    );
  }

  // Варианты
  if (session.step === "options") {
    const options = message
      .split("\n")
      .map((option) => option.trim())
      .filter(Boolean);

    if (options.length < 2 || options.length > 10) {
      return ctx.reply("Нужно указать от 2 до 10 вариантов.");
    }

    session.options = options.map((text) => ({
      text,
      url: null,
    }));

    session.step = "link";
    session.linkIndex = 0;

    return askForLink(ctx, session);
  }

  // Ссылки
  if (session.step === "link") {
    let url;

    try {
      url = new URL(message);

      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Invalid protocol");
      }
    } catch {
      return ctx.reply(
        "Это некорректная ссылка.\n" +
          "Отправь ссылку с https:// или http:// либо напиши /skip.",
      );
    }

    session.options[session.linkIndex].url = url.href;
    session.linkIndex++;

    if (session.linkIndex < session.options.length) {
      return askForLink(ctx, session);
    }

    await finishPoll(ctx, session);
  }
});

// Проверка
bot.command("ping", (ctx) => {
  ctx.reply("Pong! Бот работает!");
});

// Запуск
bot.launch();

console.log("Бот успешно запущен!");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
