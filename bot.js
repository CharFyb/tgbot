
import { Telegraf } from "telegraf";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.BOT_TOKEN) {
  throw new Error("BOT_TOKEN не найден! Проверь переменные Railway.");
}

const bot = new Telegraf(process.env.BOT_TOKEN);

const sessions = new Map();
const polls = new Map();

let groupChatId = null;

// Экранирование HTML
function escapeHTML(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

// Имя пользователя для отображения
function getUserName(user) {
  if (user.username) {
    return `@${escapeHTML(user.username)}`;
  }

  return escapeHTML(
    [user.first_name, user.last_name].filter(Boolean).join(" ") || "Пользователь"
  );
}

// Формирование сообщения с результатами
function buildPollMessage(poll) {
  let message = `<b>${escapeHTML(poll.title)}</b>\n\n`;

  poll.options.forEach((option, index) => {
    const voters = [];

    for (const [userId, vote] of poll.votes.entries()) {
      if (vote.optionIndex === index) {
        voters.push(vote.name);
      }
    }

    message += `<b>${index + 1}. ${escapeHTML(option.text)}</b> — ${voters.length} голосов\n`;

    if (voters.length > 0) {
      message += voters.map((name) => `   • ${name}`).join("\n");
      message += "\n";
    }

    message += "\n";
  });

  const totalVotes = poll.votes.size;
  message += `Всего проголосовало: ${totalVotes}`;

  return message;
}

// Формирование клавиатуры
function buildPollKeyboard(poll) {
  const keyboard = [];

  poll.options.forEach((option, index) => {
    let count = 0;

    for (const vote of poll.votes.values()) {
      if (vote.optionIndex === index) count++;
    }

    keyboard.push([
      {
        text: `${index + 1}. ${option.text} — ${count}`,
        callback_data: `vote:${poll.id}:${index}`,
      },
    ]);
  });

  poll.options.forEach((option) => {
    if (option.url) {
      keyboard.push([
        {
          text: `🔗 ${option.text}`,
          url: option.url,
        },
      ]);
    }
  });

  return { inline_keyboard: keyboard };
}

// Обновление опубликованного опроса
async function updatePollMessage(ctx, poll) {
  await ctx.telegram.editMessageText(
    poll.chatId,
    poll.messageId,
    undefined,
    buildPollMessage(poll),
    {
      parse_mode: "HTML",
      reply_markup: buildPollKeyboard(poll),
    }
  );
}

// Запрос ссылки
function askForLink(ctx, session) {
  const index = session.linkIndex;
  const option = session.options[index];

  return ctx.reply(
    `Вариант ${index + 1}: ${option.text}\n\n` +
    "Отправь ссылку для этого варианта.\n" +
    "Если ссылки нет, напиши /skip"
  );
}

// Завершение создания
async function finishPoll(ctx, session) {
  const pollId = Date.now().toString();

  const poll = {
    id: pollId,
    title: session.title,
    options: session.options,
    votes: new Map(),
    chatId: null,
    messageId: null,
  };

  polls.set(pollId, poll);
  sessions.delete(ctx.from.id);

  let preview = `<b>${escapeHTML(poll.title)}</b>\n\n`;

  poll.options.forEach((option, index) => {
    preview += `${index + 1}. ${escapeHTML(option.text)}\n`;
    preview += option.url ? "🔗 Ссылка прикреплена\n\n" : "Без ссылки\n\n";
  });

  preview += "Черновик готов. Нажми кнопку ниже, чтобы опубликовать его в группе.";

  const keyboard = [];

  poll.options.forEach((option) => {
    if (option.url) {
      keyboard.push([
        {
          text: `🔗 ${option.text}`,
          url: option.url,
        },
      ]);
    }
  });

  keyboard.push([
    {
      text: "📢 Опубликовать в группу",
      callback_data: `publish:${pollId}`,
    },
  ]);

  await ctx.reply(preview, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: keyboard },
  });
}

// Старт
bot.start((ctx) => {
  ctx.reply(
    "Привет! Я бот для голосований.\n\n" +
    "/create — создать голосование\n" +
    "/cancel — отменить создание\n\n" +
    "Создавай опросы здесь, а публикуй их в своей группе."
  );
});

// Настройка группы
bot.command("setgroup", async (ctx) => {
  if (ctx.chat.type === "private") {
    return ctx.reply("Отправь /setgroup непосредственно в нужной группе.");
  }

  try {
    const member = await ctx.telegram.getChatMember(
      ctx.chat.id,
      ctx.from.id
    );

    if (!["creator", "administrator"].includes(member.status)) {
      return ctx.reply("Настраивать группу может только администратор.");
    }

    groupChatId = ctx.chat.id;

    await ctx.reply(
      "✅ Группа сохранена!\nТеперь можешь создавать опросы в личке и публиковать их здесь."
    );
  } catch (error) {
    console.error(error);
    ctx.reply("Не удалось настроить группу. Проверь права бота.");
  }
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

// Публикация в группу
bot.action(/^publish:(.+)$/, async (ctx) => {
  const pollId = ctx.match[1];
  const poll = polls.get(pollId);

  if (!poll) {
    return ctx.answerCbQuery("Опрос не найден. Создай его заново.");
  }

  if (!groupChatId) {
    return ctx.answerCbQuery("Сначала отправь /setgroup в группе.");
  }

  try {
    const sentMessage = await ctx.telegram.sendMessage(
      groupChatId,
      buildPollMessage(poll),
      {
        parse_mode: "HTML",
        reply_markup: buildPollKeyboard(poll),
      }
    );

    poll.chatId = sentMessage.chat.id;
    poll.messageId = sentMessage.message_id;

    await ctx.answerCbQuery("Опрос опубликован!");
    await ctx.reply("✅ Опрос успешно опубликован в группе!");
  } catch (error) {
    console.error(error);
    await ctx.answerCbQuery("Ошибка публикации. Проверь права бота.");
  }
});

// Голосование
bot.action(/^vote:(.+):(\d+)$/, async (ctx) => {
  const pollId = ctx.match[1];
  const optionIndex = Number(ctx.match[2]);

  const poll = polls.get(pollId);

  if (!poll || !poll.chatId || !poll.messageId) {
    return ctx.answerCbQuery("Опрос не найден.");
  }

  if (optionIndex < 0 || optionIndex >= poll.options.length) {
    return ctx.answerCbQuery("Такого варианта нет.");
  }

  const userId = ctx.from.id;
  const previousVote = poll.votes.get(userId);

  if (previousVote?.optionIndex === optionIndex) {
    return ctx.answerCbQuery("Ты уже проголосовал за этот вариант.");
  }

  poll.votes.set(userId, {
    optionIndex,
    name: getUserName(ctx.from),
  });

  try {
    await updatePollMessage(ctx, poll);
    await ctx.answerCbQuery("Твой голос учтён!");
  } catch (error) {
    console.error(error);
    await ctx.answerCbQuery("Голос сохранён, но сообщение не удалось обновить.");
  }
});

// Обработка текста
bot.on("text", async (ctx) => {
  if (ctx.chat.type !== "private") return;

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
      "Пример:\nВариант 1\nВариант 2\nВариант 3"
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

    if (options.some((option) => option.length > 50)) {
      return ctx.reply("Каждый вариант должен быть не длиннее 50 символов.");
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
        "Некорректная ссылка. Отправь ссылку с https:// или http:// либо напиши /skip."
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

// Запуск
bot.launch()
  .then(() => {
    console.log("Бот успешно запущен!");
  })
  .catch((error) => {
    console.error("Ошибка запуска бота:", error);
    process.exit(1);
  });

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
