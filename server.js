const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();
app.use(express.static(__dirname));
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
const ADMIN_USERNAME = "Eighth#2020";

function requireAdmin(req, res, next) {
  const adminUsername = req.headers["x-admin-username"];

  if (adminUsername !== ADMIN_USERNAME) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  next();
}

const JWT_SECRET = "berserk_secret_key";
const PORT = process.env.PORT || 3000;
async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        ok: false,
        error: "Нет токена"
      });
    }

    const token = authHeader.split(" ")[1];
    let decoded;

try {
  decoded = jwt.verify(token, JWT_SECRET);
} catch (error) {
  if (error.name === "TokenExpiredError") {
    decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
  } else {
    throw error;
  }
}

    const result = await pool.query(
      "SELECT id, username, email, role, is_partner FROM users WHERE id = $1",
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        ok: false,
        error: "Пользователь не найден"
      });
    }

    const user = result.rows[0];

    if (user.role === "banned") {
      return res.status(403).json({
        ok: false,
        error: "Аккаунт заблокирован"
      });
    }

    req.user = user;
    next();

  } catch (error) {
    return res.status(401).json({
      ok: false,
      error: "Неверный токен"
    });
  }
}

function requireRoles(...roles) {
  return function(req, res, next) {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        ok: false,
        error: "Недостаточно прав"
      });
    }

    next();
  };
}
function isStaff(user){
  return ["admin", "developer", "moderator", "creator"].includes(user.role);
}

function isDeleteStaff(user){
  return ["admin", "developer", "moderator"].includes(user.role);
}

async function canManageTournament(req, tournamentId){
  const tournamentResult = await pool.query(
    "SELECT * FROM tournaments WHERE id = $1",
    [tournamentId]
  );

  if(tournamentResult.rows.length === 0){
    return { ok: false, status: 404, error: "Турнир не найден" };
  }

  const tournament = tournamentResult.rows[0];

  if(isStaff(req.user) || Number(tournament.organizer_id) === Number(req.user.id)){
    return { ok: true, tournament };
  }

    return { ok: false, status: 403, error: "Недостаточно прав" };
}

async function canDeleteTournament(req, tournamentId){
  const tournamentResult = await pool.query(
    "SELECT * FROM tournaments WHERE id = $1",
    [tournamentId]
  );

  if(tournamentResult.rows.length === 0){
    return { ok: false, status: 404, error: "Турнир не найден" };
  }

  const tournament = tournamentResult.rows[0];

  if(isDeleteStaff(req.user) || Number(tournament.organizer_id) === Number(req.user.id)){
    return { ok: true, tournament };
  }

  return { ok: false, status: 403, error: "Недостаточно прав" };
}

async function canEditTournamentPlay(req, tournamentId){
  const access = await canManageTournament(req, tournamentId);

  if(access.ok){
    return access;
  }

  const tournamentResult = await pool.query(
    "SELECT * FROM tournaments WHERE id = $1",
    [tournamentId]
  );

  if(tournamentResult.rows.length === 0){
    return { ok: false, status: 404, error: "Турнир не найден" };
  }

  const tournament = tournamentResult.rows[0];

  const playersCanEdit =
    tournament.players_can_edit === true ||
    tournament.players_can_edit === "true" ||
    tournament.players_can_edit === 1 ||
    tournament.players_can_edit === "1";

  if(!playersCanEdit){
    return {
      ok: false,
      status: 403,
      error: "Редактировать может только организатор или админ"
    };
  }

  const participantResult = await pool.query(
    "SELECT id FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2",
    [tournamentId, req.user.id]
  );

  if(participantResult.rows.length === 0){
    return {
      ok: false,
      status: 403,
      error: "Редактировать могут только участники турнира"
    };
  }

  return { ok: true, tournament };
}
async function ensurePartnerColumn() {
  await pool.query(`
    ALTER TABLE tournament_participants
    ADD COLUMN IF NOT EXISTS contact_info TEXT
  `);
  await pool.query(`
  CREATE TABLE IF NOT EXISTS site_chat_messages (
    id SERIAL PRIMARY KEY,
    channel TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    is_partner BOOLEAN DEFAULT false,
    text TEXT DEFAULT '',
    media_type TEXT DEFAULT '',
    media_name TEXT DEFAULT '',
    media_data TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW()
  )
`);
}



// =========================
// Главная страница
// =========================

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/BerserHeroesOnline.html");
});



// =========================
// Проверка API
// =========================

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    message: "API работает",
    project: "Berserk Heroes Online"
  });
});



// =========================
// Проверка PostgreSQL
// =========================

app.get("/api/db-test", async (req, res) => {

  try {

    const result = await pool.query("SELECT NOW()");

    res.json({
      ok: true,
      message: "PostgreSQL подключен",
      time: result.rows[0].now
    });

  } catch (error) {

    res.status(500).json({
      ok: false,
      error: error.message
    });

  }

});



// =========================
// РЕГИСТРАЦИЯ
// =========================

app.post("/api/register", async (req, res) => {

  try {

    const { username, email, password } = req.body;

    const nicknamePattern = /^[A-Za-zА-Яа-яЁё0-9_]{2,24}#[0-9]{4,5}$/;



    if (!username || !email || !password) {

      return res.status(400).json({
        ok: false,
        error: "Введите ник, email и пароль"
      });

    }



    if (!nicknamePattern.test(username)) {

      return res.status(400).json({
        ok: false,
        error: "Ник должен быть в формате Eighth#2020"
      });

    }



    if (password.length < 6) {

      return res.status(400).json({
        ok: false,
        error: "Пароль должен быть минимум 6 символов"
      });

    }



    const existingUser = await pool.query(
      "SELECT id FROM users WHERE username = $1 OR email = $2",
      [username, email]
    );



    if (existingUser.rows.length > 0) {

      return res.status(400).json({
        ok: false,
        error: "Такой ник или email уже занят"
      });

    }



    const hashedPassword = await bcrypt.hash(password, 10);



    const result = await pool.query(
  `
  INSERT INTO users (username, email, password)
  VALUES ($1, $2, $3)
  RETURNING id, username, email, role, is_partner, created_at
  `,
  [username, email, hashedPassword]
);

const user = result.rows[0];

const token = jwt.sign(
  {
    id: user.id,
    username: user.username
  },
  JWT_SECRET,
  {
    expiresIn: "30d"
  }
);



    res.json({
      ok: true,
      message: "Регистрация успешна",
      token,
      user
    });

  } catch (error) {

    console.error("REGISTER ERROR:", error);

    res.status(500).json({
      ok: false,
      error: error.message
    });

  }

});



// =========================
// ВХОД
// =========================

app.post("/api/login", async (req, res) => {

  try {

    const { username, password } = req.body;



    if (!username || !password) {

      return res.status(400).json({
        ok: false,
        error: "Введите ник и пароль"
      });

    }



    const userResult = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );



    if (userResult.rows.length === 0) {

      return res.status(400).json({
        ok: false,
        error: "Неверный ник или пароль"
      });

    }



    const user = userResult.rows[0];

if (user.role === "banned") {

  return res.status(403).json({
    ok: false,
    error: "Аккаунт заблокирован"
  });

}

const isPasswordCorrect = await bcrypt.compare(
  password,
  user.password
);



    if (!isPasswordCorrect) {

      return res.status(400).json({
        ok: false,
        error: "Неверный ник или пароль"
      });

    }



    const token = jwt.sign(
      {
        id: user.id,
        username: user.username
      },
      JWT_SECRET,
      {
        expiresIn: "30d"
      }
    );



    res.json({
      ok: true,
      message: "Вход выполнен успешно",

      token,

      user: {
  id: user.id,
  username: user.username,
  email: user.email,
  role: user.role,
  is_partner: !!user.is_partner
}

    });

  } catch (error) {

    console.error("LOGIN ERROR:", error);

    res.status(500).json({
      ok: false,
      error: error.message
    });

  }

});



// =========================
// СТАРТ СЕРВЕРА
// =========================

app.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, email, role, is_partner, created_at FROM users ORDER BY id"
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка получения пользователей" });
  }
});

app.patch("/admin/users/:id/role", requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    const { id } = req.params;

    const allowedRoles = [
  "user",
  "admin",
  "developer",
  "moderator",
  "vip",
  "creator",
  "banned"
];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: "Такой роли не существует" });
    }

    const result = await pool.query(
      "UPDATE users SET role = $1 WHERE id = $2 RETURNING id, username, email, role",
      [role, id]
    );
await pool.query(
  "UPDATE news SET author_role = $1 WHERE author_id = $2",
  [role, id]
);

await pool.query(
  "UPDATE news_comments SET author_role = $1 WHERE user_id = $2",
  [role, id]
);

await pool.query(
  "UPDATE tournaments SET organizer_role = $1 WHERE organizer_id = $2",
  [role, id]
);

await pool.query(
  "UPDATE tournament_participants SET role = $1 WHERE user_id = $2",
  [role, id]
);

await pool.query(
  "UPDATE decks SET author_role = $1 WHERE author_id = $2",
  [role, id]
);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка смены роли" });
  }
});
app.patch("/admin/users/:id/partner", requireAdmin, async (req, res) => {
  try {
    const { is_partner } = req.body;
    const { id } = req.params;

    const result = await pool.query(
      "UPDATE users SET is_partner = $1 WHERE id = $2 RETURNING id, username, email, role, is_partner",
      [!!is_partner, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка смены партнёрской звезды" });
  }
});
app.delete("/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "DELETE FROM users WHERE id = $1 RETURNING id, username",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json({ message: "Пользователь удалён", user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка удаления пользователя" });
  }
});
ensurePartnerColumn().then(() => {
  // =========================
// НОВОСТИ
// =========================

// Получить все новости
app.get("/api/news", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT *
      FROM news
      ORDER BY created_at DESC
    `);

    res.json({
      ok: true,
      news: result.rows
    });

  } catch (error) {

    res.status(500).json({
      ok: false,
      error: error.message
    });

  }

});



// Создать новость
app.post("/api/news", verifyToken, requireRoles("admin", "developer", "moderator", "creator"), async (req, res) => {

  try {

    const {
      title,
      text,
      cover,
      extra_images,
      author_id,
      author_name,
      author_role,
      author_is_partner
    } = req.body;

    if (!title || !text || !author_name) {
      return res.status(400).json({
        ok: false,
        error: "Не заполнены обязательные поля"
      });
    }

    const result = await pool.query(`
      INSERT INTO news (
        title,
        text,
        cover,
        extra_images,
        author_id,
        author_name,
        author_role,
        author_is_partner
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `, [
      title,
      text,
      cover || "",
      JSON.stringify(extra_images || []),
      author_id || null,
      author_name,
      author_role || "user",
      !!author_is_partner
    ]);

    res.json({
      ok: true,
      news: result.rows[0]
    });

  } catch (error) {

    res.status(500).json({
      ok: false,
      error: error.message
    });

  }

});



// Получить комментарии новости
app.get("/api/news/:id/comments", async (req, res) => {

  try {

    const result = await pool.query(`
  SELECT
    c.*,
    COALESCE(u.role, c.author_role) AS author_role,
    COALESCE(u.is_partner, c.author_is_partner) AS author_is_partner
  FROM news_comments c
  LEFT JOIN users u ON u.id = c.user_id
  WHERE c.news_id = $1
  ORDER BY c.created_at ASC
`, [req.params.id]);

    res.json({
      ok: true,
      comments: result.rows
    });

  } catch (error) {

    res.status(500).json({
      ok: false,
      error: error.message
    });

  }

});



// Добавить комментарий
app.post("/api/news/:id/comments", verifyToken, async (req, res) => {

  try {

    const {
      user_id,
      author_name,
      author_role,
      author_is_partner,
      text
    } = req.body;

    if (!text || !author_name) {
      return res.status(400).json({
        ok: false,
        error: "Комментарий пуст"
      });
    }

    const result = await pool.query(`
      INSERT INTO news_comments (
        news_id,
        user_id,
        author_name,
        author_role,
        author_is_partner,
        text
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
    `, [
      req.params.id,
      user_id || null,
      author_name,
      author_role || "user",
      !!author_is_partner,
      text
    ]);

    res.json({
      ok: true,
      comment: result.rows[0]
    });

  } catch (error) {

    res.status(500).json({
      ok: false,
      error: error.message
    });

  }

});
// Удалить комментарий новости
app.delete("/api/news/:newsId/comments/:commentId", verifyToken, requireRoles("admin", "developer", "moderator"), async (req, res) => {

  
  try {

    const result = await pool.query(`
      DELETE FROM news_comments
      WHERE id = $1 AND news_id = $2
      RETURNING *
    `, [
      req.params.commentId,
      req.params.newsId
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Комментарий не найден"
      });
    }

    res.json({
      ok: true
    });

  } catch (error) {

    res.status(500).json({
      ok: false,
      error: error.message
    });

  }

});  
// Удалить новость
app.delete("/api/news/:id", verifyToken, requireRoles("admin", "developer", "moderator"), async (req, res) => {

  try {

    const result = await pool.query(`
      DELETE FROM news
      WHERE id = $1
      RETURNING *
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Новость не найдена"
      });
    }

    res.json({
      ok: true
    });

  } catch (error) {

    res.status(500).json({
      ok: false,
      error: error.message
    });

  }

});
// Редактировать новость
app.patch("/api/news/:id", verifyToken, requireRoles("admin", "developer", "moderator"), async (req, res) => {
  try {
    const {
      title,
      text,
      cover,
      extra_images,
      author_role,
      author_is_partner
    } = req.body;

    if (!title || !text) {
      return res.status(400).json({
        ok: false,
        error: "Название и текст обязательны"
      });
    }

    const result = await pool.query(`
      UPDATE news
      SET
        title = $1,
        text = $2,
        cover = $3,
        extra_images = $4,
        author_role = $5,
        author_is_partner = $6,
        updated_at = NOW()
      WHERE id = $7
      RETURNING *
    `, [
      title,
      text,
      cover || "",
      JSON.stringify(extra_images || []),
      author_role || "user",
      !!author_is_partner,
      req.params.id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Новость не найдена"
      });
    }

    res.json({
      ok: true,
      news: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
// Получить заявки новостей
app.get("/api/news-requests", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM news_requests
      ORDER BY created_at DESC
    `);

    res.json({
      ok: true,
      requests: result.rows
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Создать заявку новости
app.post("/api/news-requests", verifyToken, async (req, res) => {
  try {
    const {
      title,
      text,
      cover,
      extra_images,
      author_name,
      author_role,
      author_is_partner
    } = req.body;

    if (!title || !text || !author_name) {
      return res.status(400).json({
        ok: false,
        error: "Не заполнены обязательные поля"
      });
    }

    const result = await pool.query(`
      INSERT INTO news_requests (
        title,
        text,
        cover,
        extra_images,
        author_name,
        author_role,
        author_is_partner
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `, [
      title,
      text,
      cover || "",
      JSON.stringify(extra_images || []),
      author_name,
      author_role || "user",
      !!author_is_partner
    ]);

    res.json({
      ok: true,
      request: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Удалить заявку новости
app.delete("/api/news-requests/:id", verifyToken, requireRoles("admin"), async (req, res) => {
  try {
    const result = await pool.query(`
      DELETE FROM news_requests
      WHERE id = $1
      RETURNING *
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Заявка не найдена"
      });
    }

    res.json({ ok: true });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
// =========================
// ЧАТЫ САЙТА
// =========================

function canDeleteSiteChatMessage(user, message){
  const userRole = String(user.role || "user");
  const messageRole = String(message.role || "user");

  if(messageRole === "admin"){
    return userRole === "admin";
  }

  if(["admin","developer","moderator"].includes(userRole)){
    return true;
  }

  return Number(user.id) === Number(message.user_id);
}

function isAllowedSiteChatChannel(channel){
  return ["flood","tech"].includes(channel);
}

app.get("/api/site-chats/:channel/messages", verifyToken, async (req,res)=>{
  try{
    const channel = req.params.channel;

    if(!isAllowedSiteChatChannel(channel)){
      return res.status(400).json({
        ok:false,
        error:"Такого чата нет"
      });
    }

    const result = await pool.query(`
      SELECT
        m.id,
        m.channel,
        m.user_id,
        COALESCE(u.username, m.username) AS username,
        COALESCE(u.role, m.role) AS role,
        COALESCE(u.is_partner, m.is_partner) AS is_partner,
        m.text,
        m.media_type,
        m.media_name,
        m.media_data,
        m.created_at
      FROM site_chat_messages m
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.channel = $1
      ORDER BY m.created_at ASC
    `,[channel]);

    res.json({
      ok:true,
      messages:result.rows
    });

  }catch(error){
    res.status(500).json({
      ok:false,
      error:error.message
    });
  }
});
app.post("/api/site-chats/:channel/messages", verifyToken, async (req,res)=>{
  try{
    const channel = req.params.channel;

    if(!isAllowedSiteChatChannel(channel)){
      return res.status(400).json({
        ok:false,
        error:"Такого чата нет"
      });
    }

    const text = String(req.body.text || "").trim();
    const mediaType = String(req.body.mediaType || "").trim();
    const mediaName = String(req.body.mediaName || "").trim();
    const mediaData = String(req.body.mediaData || "").trim();

    if(!text && !mediaData){
      return res.status(400).json({
        ok:false,
        error:"Сообщение пустое"
      });
    }

    if(mediaData){
      if(!["image/webp","video/webm"].includes(mediaType)){
        return res.status(400).json({
          ok:false,
          error:"Можно загружать только WEBP или WEBM"
        });
      }

      const sizeApprox = Math.ceil((mediaData.length * 3) / 4);

      if(sizeApprox > 5 * 1024 * 1024){
        return res.status(400).json({
          ok:false,
          error:"Файл больше 5 МБ"
        });
      }
    }

    const result = await pool.query(`
      INSERT INTO site_chat_messages (
        channel,
        user_id,
        username,
        role,
        is_partner,
        text,
        media_type,
        media_name,
        media_data
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `,[
      channel,
      req.user.id,
      req.user.username,
      req.user.role || "user",
      !!req.user.is_partner,
      text,
      mediaType,
      mediaName,
      mediaData
    ]);

    res.json({
      ok:true,
      message:result.rows[0]
    });

  }catch(error){
    res.status(500).json({
      ok:false,
      error:error.message
    });
  }
});

app.delete("/api/site-chats/:channel/messages/:id", verifyToken, async (req,res)=>{
  try{
    const channel = req.params.channel;

    if(!isAllowedSiteChatChannel(channel)){
      return res.status(400).json({
        ok:false,
        error:"Такого чата нет"
      });
    }

    const messageResult = await pool.query(`
      SELECT *
      FROM site_chat_messages
      WHERE id = $1 AND channel = $2
    `,[req.params.id, channel]);

    if(messageResult.rows.length === 0){
      return res.status(404).json({
        ok:false,
        error:"Сообщение не найдено"
      });
    }

    const message = messageResult.rows[0];

    if(!canDeleteSiteChatMessage(req.user, message)){
      return res.status(403).json({
        ok:false,
        error:"Нет прав удалить это сообщение"
      });
    }

    await pool.query(`
      DELETE FROM site_chat_messages
      WHERE id = $1 AND channel = $2
    `,[req.params.id, channel]);

    res.json({ ok:true });

  }catch(error){
    res.status(500).json({
      ok:false,
      error:error.message
    });
  }
});
// =========================
// ТУРНИРЫ
// =========================

// Получить все турниры
app.get("/api/tournaments", async (req, res) => {
  try {
    const tournamentsResult = await pool.query(`
      SELECT *
      FROM tournaments
      ORDER BY created_at DESC
    `);

    const participantsResult = await pool.query(`
      SELECT *
      FROM tournament_participants
      ORDER BY joined_at ASC
    `);

    const matchesResult = await pool.query(`
      SELECT *
      FROM tournament_matches
      ORDER BY round ASC, match_index ASC
    `);

    res.json({
      ok: true,
      tournaments: tournamentsResult.rows,
      participants: participantsResult.rows,
      matches: matchesResult.rows
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Создать турнир
app.post("/api/tournaments", verifyToken, requireRoles("admin", "developer", "moderator", "creator"), async (req, res) => {
  try {
    const {
  title,
  description,
  format,
  max_players,
  prize_1,
  prize_2,
  prize_3,
  prize_4,
  start_date,
end_date,
telegram_link,
bracket,
  swiss_data,
  deckMode,
  matchFormat,
  finalFormat,
  decksBeforeFinal,
  bansBeforeFinal,
  decksFinal,
  bansFinal,
isPrivate,
privatePassword
} = req.body;

    if (!title) {
      return res.status(400).json({
        ok: false,
        error: "Название турнира обязательно"
      });
    }

    const result = await pool.query(`
      INSERT INTO tournaments (
        title,
        description,
        format,
        max_players,
        organizer_id,
        organizer_name,
        organizer_role,
        organizer_is_partner,
        prize_1,
        prize_2,
        prize_3,
        prize_4,
        start_date,
end_date,
telegram_link,
bracket,
        swiss_data,
        deckMode,
matchFormat,
finalFormat,
decksBeforeFinal,
bansBeforeFinal,
decksFinal,
bansFinal,
is_private,
private_password
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
      RETURNING *
    `, [
      title,
      description || "",
      format || "single",
      Number(max_players) || 8,
      req.user.id,
      req.user.username,
      req.user.role || "user",
      !!req.user.is_partner,
      prize_1 || "",
      prize_2 || "",
      prize_3 || "",
      prize_4 || "",
      start_date || null,
end_date || null,
telegram_link || "",
Number(bracket) || Number(max_players) || 16,
      JSON.stringify(swiss_data || {}),

      deckMode || "none",
matchFormat || "bo1",
finalFormat || "bo3",
Number(decksBeforeFinal) || 1,
Number(bansBeforeFinal) || 0,
Number(decksFinal) || 1,
Number(bansFinal) || 0,
!!isPrivate,
isPrivate ? (privatePassword || "") : ""
    ]);

    res.json({
      ok: true,
      tournament: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Записаться на турнир
app.post("/api/tournaments/:id/join", verifyToken, async (req, res) => {
  try {
    const tournamentId = req.params.id;
const { decks, password, contactInfo } = req.body;

    const tournamentResult = await pool.query(
      "SELECT * FROM tournaments WHERE id = $1",
      [tournamentId]
    );

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Турнир не найден"
      });
    }

    const tournament = tournamentResult.rows[0];
    const tournamentStartRaw = tournament.start_date || tournament.date;

if(tournamentStartRaw){
  const tournamentDate = new Date(tournamentStartRaw);

  if(!Number.isNaN(tournamentDate.getTime()) && Date.now() >= tournamentDate.getTime()){
    return res.status(403).json({
      ok:false,
      error:"Турнир уже закрыт. Время регистрации окончено."
    });
  }
}
const isMainAdmin =
  String(req.user.username || "").trim() === "Eighth#2020";
const forceJoin = req.body.forceJoin === true;

if(
  tournament.is_private &&
  String(password || "") !== String(tournament.private_password || "") &&
  !(isMainAdmin && forceJoin)
){
  return res.status(403).json({
    ok: false,
    error: "Неверный пароль турнира",
    canForceJoin: isMainAdmin
  });
}
    const countResult = await pool.query(
      "SELECT COUNT(*) FROM tournament_participants WHERE tournament_id = $1",
      [tournamentId]
    );

    const count = Number(countResult.rows[0].count);

    if (count >= Number(tournament.max_players)) {
      return res.status(400).json({
        ok: false,
        error: "Мест больше нет"
      });
    }

    const existsResult = await pool.query(
      "SELECT id FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2",
      [tournamentId, req.user.id]
    );

    if (existsResult.rows.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "Ты уже записан на этот турнир"
      });
    }

    const result = await pool.query(`
      INSERT INTO tournament_participants (
  tournament_id,
  user_id,
  username,
  role,
  is_partner,
  decks,
  contact_info
)
VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `, [
      tournamentId,
req.user.id,
req.user.username,
req.user.role || "user",
!!req.user.is_partner,
JSON.stringify(decks || []),
String(contactInfo || "").trim()
    ]);

    res.json({
      ok: true,
      participant: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
// Покинуть турнир
app.delete("/api/tournaments/:id/leave", verifyToken, async (req, res) => {
  try {
    const tournamentId = req.params.id;

    const tournamentResult = await pool.query(
      "SELECT * FROM tournaments WHERE id = $1",
      [tournamentId]
    );

    if(tournamentResult.rows.length === 0){
      return res.status(404).json({
        ok: false,
        error: "Турнир не найден"
      });
    }

    const tournament = tournamentResult.rows[0];

    if(tournament.status === "closed" || tournament.status === "finished"){
      return res.status(400).json({
        ok: false,
        error: "Из этого турнира уже нельзя выйти"
      });
    }

    const result = await pool.query(
      `
      DELETE FROM tournament_participants
      WHERE tournament_id = $1 AND user_id = $2
      RETURNING *
      `,
      [tournamentId, req.user.id]
    );

    if(result.rows.length === 0){
      return res.status(404).json({
        ok: false,
        error: "Ты не зарегистрирован на этот турнир"
      });
    }

    res.json({
      ok: true,
      message: "Ты покинул турнир"
    });

  } catch(error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
// Редактировать турнир
app.patch("/api/tournaments/:id", verifyToken, async (req, res) => {
  try {
    const access = await canManageTournament(req, req.params.id);

    if(!access.ok){
      return res.status(access.status).json({
        ok: false,
        error: access.error
      });
    }

    const {
      title,
      description,
      format,
      max_players,
      bracket,
      prize_1,
      prize_2,
      prize_3,
      prize_4,
      start_date,
end_date,
telegram_link,
deckMode,
      matchFormat,
      finalFormat,
      decksBeforeFinal,
      bansBeforeFinal,
      decksFinal,
      bansFinal,
      isPrivate,
      privatePassword
    } = req.body;

    const result = await pool.query(`
      UPDATE tournaments
      SET
        title = $1,
        description = $2,
        format = $3,
        max_players = $4,
        prize_1 = $5,
        prize_2 = $6,
        prize_3 = $7,
        prize_4 = $8,
        start_date = $9,
end_date = $10,
telegram_link = $11,
deckMode = $12,
        matchFormat = $13,
        finalFormat = $14,
        decksBeforeFinal = $15,
        bansBeforeFinal = $16,
        decksFinal = $17,
        bansFinal = $18,
        is_private = $19,
        private_password = $20,
bracket = $21
WHERE id = $22
      RETURNING *
    `, [
      title || "",
      description || "",
      format || "single",
      Number(max_players) || 8,
      prize_1 || "",
      prize_2 || "",
      prize_3 || "",
      prize_4 || "",
      start_date || null,
end_date || null,
telegram_link || "",
deckMode || "none",
      matchFormat || "bo1",
      finalFormat || "bo3",
      Number(decksBeforeFinal) || 1,
      Number(bansBeforeFinal) || 0,
      Number(decksFinal) || 1,
      Number(bansFinal) || 0,
      !!isPrivate,
      isPrivate ? (privatePassword || "") : "",
Number(bracket) || Number(max_players) || 16,
req.params.id
    ]);

    res.json({
      ok: true,
      tournament: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
// Удалить турнир
app.delete("/api/tournaments/:id", verifyToken, async (req, res) => {
  try {
    const access = await canDeleteTournament(req, req.params.id);

if(!access.ok){
  return res.status(access.status).json({
    ok: false,
    error: access.error
  });
}
    const result = await pool.query(
      "DELETE FROM tournaments WHERE id = $1 RETURNING *",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Турнир не найден"
      });
    }

    res.json({ ok: true });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
// =========================
// ТУРНИРЫ
// =========================

// Получить все турниры
app.get("/api/tournaments", async (req, res) => {
  try {
    const tournamentsResult = await pool.query(`
      SELECT *
      FROM tournaments
      ORDER BY created_at DESC
    `);

    const participantsResult = await pool.query(`
      SELECT *
      FROM tournament_participants
      ORDER BY joined_at ASC
    `);

    const matchesResult = await pool.query(`
      SELECT *
      FROM tournament_matches
      ORDER BY round ASC, match_index ASC
    `);

    res.json({
      ok: true,
      tournaments: tournamentsResult.rows,
      participants: participantsResult.rows,
      matches: matchesResult.rows
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Создать турнир
app.post("/api/tournaments", verifyToken, requireRoles("admin", "developer", "moderator", "creator"), async (req, res) => {
  try {
    const {
  title,
  description,
  format,
  max_players,
  prize_1,
  prize_2,
  prize_3,
  prize_4,
  start_date,
  telegram_link,
  bracket,
  swiss_data,
  deckMode,
  matchFormat,
  finalFormat,
  decksBeforeFinal,
  bansBeforeFinal,
  decksFinal,
bansFinal,
isPrivate,
privatePassword
} = req.body;

    if (!title) {
      return res.status(400).json({
        ok: false,
        error: "Название турнира обязательно"
      });
    }

    const result = await pool.query(`
      INSERT INTO tournaments (
        title,
        description,
        format,
        max_players,
        organizer_id,
        organizer_name,
        organizer_role,
        organizer_is_partner,
        prize_1,
        prize_2,
        prize_3,
        prize_4,
        start_date,
        telegram_link,
        bracket,
        swiss_data,
        deckMode,
matchFormat,
finalFormat,
decksBeforeFinal,
bansBeforeFinal,
decksFinal,
bansFinal,
is_private,
private_password
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
      RETURNING *
    `, [
      title,
      description || "",
      format || "single",
      Number(max_players) || 8,
      req.user.id,
      req.user.username,
      req.user.role || "user",
      !!req.user.is_partner,
      prize_1 || "",
      prize_2 || "",
      prize_3 || "",
      prize_4 || "",
      start_date || null,
      telegram_link || "",
      Number(bracket) || Number(max_players) || 16,
      JSON.stringify(swiss_data || {}),
      deckMode || "none",
matchFormat || "bo1",
finalFormat || "bo3",
Number(decksBeforeFinal) || 1,
Number(bansBeforeFinal) || 0,
Number(decksFinal) || 1,
Number(bansFinal) || 0,
!!isPrivate,
isPrivate ? (privatePassword || "") : ""
    ]);

    res.json({
      ok: true,
      tournament: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Записаться на турнир
app.post("/api/tournaments/:id/join", verifyToken, async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const { decks, password, contactInfo } = req.body;

    const tournamentResult = await pool.query(
      "SELECT * FROM tournaments WHERE id = $1",
      [tournamentId]
    );

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Турнир не найден"
      });
    }

    const tournament = tournamentResult.rows[0];
    const tournamentStartRaw = tournament.start_date || tournament.date;

if(tournamentStartRaw){
  const tournamentDate = new Date(tournamentStartRaw);

  if(!Number.isNaN(tournamentDate.getTime()) && Date.now() >= tournamentDate.getTime()){
    return res.status(403).json({
      ok:false,
      error:"Турнир уже закрыт. Время регистрации окончено."
    });
  }
}
const isMainAdmin =
  String(req.user.username || "").trim() === "Eighth#2020";
const forceJoin = req.body.forceJoin === true;

if(
  tournament.is_private &&
  String(password || "") !== String(tournament.private_password || "") &&
  !(isMainAdmin && forceJoin)
){
  return res.status(403).json({
    ok: false,
    error: "Неверный пароль турнира",
    canForceJoin: isMainAdmin
  });
}
    const countResult = await pool.query(
      "SELECT COUNT(*) FROM tournament_participants WHERE tournament_id = $1",
      [tournamentId]
    );

    const count = Number(countResult.rows[0].count);

    if (count >= Number(tournament.max_players)) {
      return res.status(400).json({
        ok: false,
        error: "Мест больше нет"
      });
    }

    const existsResult = await pool.query(
      "SELECT id FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2",
      [tournamentId, req.user.id]
    );

    if (existsResult.rows.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "Ты уже записан на этот турнир"
      });
    }

    const result = await pool.query(`
      INSERT INTO tournament_participants (
  tournament_id,
  user_id,
  username,
  role,
  is_partner,
  decks,
  contact_info
)
VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `, [
      tournamentId,
      req.user.id,
      req.user.username,
      req.user.role || "user",
!!req.user.is_partner,
JSON.stringify(decks || []),
String(contactInfo || "").trim()
    ]);

    res.json({
      ok: true,
      participant: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
// Покинуть турнир
app.delete("/api/tournaments/:id/leave", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `
      DELETE FROM tournament_participants
      WHERE tournament_id = $1 AND user_id = $2
      RETURNING *
      `,
      [req.params.id, req.user.id]
    );

    if(result.rows.length === 0){
      return res.status(404).json({
        ok: false,
        error: "Ты не зарегистрирован на этот турнир"
      });
    }

    res.json({ ok: true });

  } catch(error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Сохранить стартовый рандом сетки — только организатор, админ, разработчик, модератор
app.patch("/api/tournaments/:id/random-play", verifyToken, async (req, res) => {
  try {
    const access = await canDeleteTournament(req, req.params.id);

    if(!access.ok){
      return res.status(access.status).json({
        ok: false,
        error: access.error
      });
    }

    const { bracket, swiss_data } = req.body;

    const result = await pool.query(`
      UPDATE tournaments
      SET
        bracket = $1,
        swiss_data = $2
      WHERE id = $3
      RETURNING *
    `, [
      JSON.stringify(bracket || []),
      JSON.stringify(swiss_data || {}),
      req.params.id
    ]);

    res.json({
      ok: true,
      tournament: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Сохранить сетку / счёт турнира
app.patch("/api/tournaments/:id/play", verifyToken, async (req, res) => {
  try {
    const access = await canEditTournamentPlay(req, req.params.id);

    if(!access.ok){
      return res.status(access.status).json({
        ok: false,
        error: access.error
      });
    }

    const { bracket, swiss_data } = req.body;

    const result = await pool.query(`
      UPDATE tournaments
      SET
        bracket = $1,
        swiss_data = $2
      WHERE id = $3
      RETURNING *
    `, [
      JSON.stringify(bracket || []),
      JSON.stringify(swiss_data || {}),
      req.params.id
    ]);

    res.json({
      ok: true,
      tournament: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});// Сохранить матч-комнату
app.patch("/api/tournaments/:id/match-room", verifyToken, async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const { roomKey, room } = req.body;

    const tournamentResult = await pool.query(
      "SELECT * FROM tournaments WHERE id = $1",
      [tournamentId]
    );

    if(tournamentResult.rows.length === 0){
      return res.status(404).json({
        ok: false,
        error: "Турнир не найден"
      });
    }

    const tournament = tournamentResult.rows[0];

    const isStaffUser = isStaff(req.user);
    const isOrganizer = Number(tournament.organizer_id) === Number(req.user.id);

    const isMatchPlayer =
      String(req.user.username || "") === String(room?.playerA || "") ||
      String(req.user.username || "") === String(room?.playerB || "");

    if(!isStaffUser && !isOrganizer && !isMatchPlayer){
      return res.status(403).json({
        ok: false,
        error: "Менять матч могут только игроки матча, организатор или админ"
      });
    }

    let swissData = {};

    try{
      swissData = typeof tournament.swiss_data === "string"
        ? JSON.parse(tournament.swiss_data || "{}")
        : (tournament.swiss_data || {});
    }catch(e){
      swissData = {};
    }

    swissData.matchRooms = swissData.matchRooms || {};
    swissData.matchRooms[roomKey] = room;

    const result = await pool.query(`
      UPDATE tournaments
      SET swiss_data = $1
      WHERE id = $2
      RETURNING *
    `, [
      JSON.stringify(swissData),
      tournamentId
    ]);

    res.json({
      ok: true,
      tournament: result.rows[0]
    });

  }catch(error){
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
function isTournamentChatStaff(user){
  return ["admin","developer","moderator"].includes(user.role);
}

async function canUseTournamentChat(req, tournamentId){

  const tournamentResult = await pool.query(
    "SELECT id FROM tournaments WHERE id = $1",
    [tournamentId]
  );

  if(tournamentResult.rows.length === 0){
    return {
      ok:false,
      status:404,
      error:"Турнир не найден"
    };
  }

  if(isTournamentChatStaff(req.user)){
    return { ok:true };
  }

  const participantResult = await pool.query(
    `
    SELECT id
    FROM tournament_participants
    WHERE tournament_id = $1
    AND user_id = $2
    `,
    [tournamentId, req.user.id]
  );

  if(participantResult.rows.length === 0){
    return {
      ok:false,
      status:403,
      error:"Чат доступен только участникам турнира"
    };
  }

  return { ok:true };
}
// Получить только чат матч-комнаты
app.get("/api/tournaments/:id/match-room-chat", async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const roomKey = req.query.roomKey;

    if (!roomKey) {
      return res.status(400).json({
        ok: false,
        error: "Не указан roomKey"
      });
    }

    const result = await pool.query(
      "SELECT swiss_data FROM tournaments WHERE id = $1",
      [tournamentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Турнир не найден"
      });
    }

    let swissData = {};

    try {
      swissData = typeof result.rows[0].swiss_data === "string"
        ? JSON.parse(result.rows[0].swiss_data || "{}")
        : (result.rows[0].swiss_data || {});
    } catch (e) {
      swissData = {};
    }

    const room = swissData.matchRooms?.[roomKey] || {};

    res.json({
      ok: true,
      chat: Array.isArray(room.chat) ? room.chat : []
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
app.post("/api/tournaments/:id/match-room-chat", verifyToken, async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const { roomKey, author, text } = req.body;

    if (!roomKey || !author || !text) {
      return res.status(400).json({
        ok: false,
        error: "Не хватает данных для сообщения"
      });
    }

    const result = await pool.query(
      "SELECT swiss_data, organizer_id FROM tournaments WHERE id = $1",
      [tournamentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Турнир не найден"
      });
    }

    let swissData = {};

    try {
      swissData = typeof result.rows[0].swiss_data === "string"
        ? JSON.parse(result.rows[0].swiss_data || "{}")
        : (result.rows[0].swiss_data || {});
    } catch (e) {
      swissData = {};
    }

    swissData.matchRooms = swissData.matchRooms || {};
    const room = swissData.matchRooms[roomKey];

    if (!room) {
      return res.status(404).json({
        ok: false,
        error: "Комната матча не найдена"
      });
    }

    const isStaffUser = isStaff(req.user);
const isOrganizer = Number(result.rows[0].organizer_id) === Number(req.user.id);

const isMatchPlayer =
  String(req.user.username || "") === String(room.playerA || "") ||
  String(req.user.username || "") === String(room.playerB || "");

if (!isStaffUser && !isOrganizer && !isMatchPlayer) {
  return res.status(403).json({
    ok: false,
    error: "Писать могут только игроки этой пары"
  });
}

    room.chat = Array.isArray(room.chat) ? room.chat : [];
    room.chat.push({
      author,
      text,
      time: new Date().toISOString()
    });

    swissData.matchRooms[roomKey] = room;

    await pool.query(
      "UPDATE tournaments SET swiss_data = $1 WHERE id = $2",
      [JSON.stringify(swissData), tournamentId]
    );

    res.json({
      ok: true,
      chat: room.chat
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
// Общий чат турнира
app.get("/api/tournaments/:id/chat", verifyToken, async (req,res)=>{
  try{

    const tournamentId = req.params.id;

    const access = await canUseTournamentChat(req,tournamentId);

    if(!access.ok){
      return res.status(access.status).json(access);
    }

    const result = await pool.query(
      "SELECT swiss_data FROM tournaments WHERE id = $1",
      [tournamentId]
    );

    let swissData = {};

    try{
      swissData =
        typeof result.rows[0].swiss_data === "string"
        ? JSON.parse(result.rows[0].swiss_data || "{}")
        : (result.rows[0].swiss_data || {});
    }catch(e){}

    res.json({
      ok:true,
      chat: swissData.tournamentChat || []
    });

  }catch(error){
    res.status(500).json({
      ok:false,
      error:error.message
    });
  }
});

app.post("/api/tournaments/:id/chat", verifyToken, async (req,res)=>{
  try{

    const tournamentId = req.params.id;

    const access = await canUseTournamentChat(req,tournamentId);

    if(!access.ok){
      return res.status(access.status).json(access);
    }

    const text = String(req.body.text || "").trim();

    if(!text){
      return res.status(400).json({
        ok:false,
        error:"Пустое сообщение"
      });
    }

    const result = await pool.query(
      "SELECT swiss_data FROM tournaments WHERE id = $1",
      [tournamentId]
    );

    let swissData = {};

    try{
      swissData =
        typeof result.rows[0].swiss_data === "string"
        ? JSON.parse(result.rows[0].swiss_data || "{}")
        : (result.rows[0].swiss_data || {});
    }catch(e){}

    swissData.tournamentChat =
      Array.isArray(swissData.tournamentChat)
      ? swissData.tournamentChat
      : [];

    swissData.tournamentChat.push({
  author:req.user.username,
  role:req.user.role,
  is_partner:!!req.user.is_partner,
  text,
  time:new Date().toISOString()
});

    await pool.query(
      "UPDATE tournaments SET swiss_data = $1 WHERE id = $2",
      [
        JSON.stringify(swissData),
        tournamentId
      ]
    );

    res.json({ ok:true });

  }catch(error){
    res.status(500).json({
      ok:false,
      error:error.message
    });
  }
});
// =========================
// КОЛОДЫ
// =========================
// Получить личные колоды пользователя
app.get("/api/player-decks", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM player_decks
      WHERE user_id = $1
      ORDER BY updated_at DESC, id DESC
    `, [req.user.id]);

    res.json({
      ok: true,
      decks: result.rows
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Сохранить личную колоду пользователя
app.post("/api/player-decks", verifyToken, async (req, res) => {
  try {
    const { title, description, cards, preview_ids } = req.body;

    if (!title || !Array.isArray(cards) || !cards.length) {
      return res.status(400).json({
        ok: false,
        error: "Название и карты обязательны"
      });
    }

    const result = await pool.query(`
      INSERT INTO player_decks (
  user_id,
  title,
  description,
  cards,
  preview_ids
)
VALUES ($1,$2,$3,$4,$5)
      RETURNING *
    `, [
      req.user.id,
title,
description || "",
JSON.stringify(cards || []),
JSON.stringify(preview_ids || [])
    ]);

    res.json({
      ok: true,
      deck: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Обновить личную колоду пользователя
app.patch("/api/player-decks/:id", verifyToken, async (req, res) => {
  try {
    const { title, description, cards, preview_ids } = req.body;

    if (!title || !Array.isArray(cards) || !cards.length) {
      return res.status(400).json({
        ok: false,
        error: "Название и карты обязательны"
      });
    }

    const result = await pool.query(`
      UPDATE player_decks
SET title = $1,
    description = $2,
    cards = $3,
    preview_ids = $4,
    updated_at = NOW()
WHERE id = $5 AND user_id = $6
      RETURNING *
    `, [
      title,
description || "",
JSON.stringify(cards || []),
JSON.stringify(preview_ids || []),
req.params.id,
req.user.id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Колода не найдена"
      });
    }

    res.json({
      ok: true,
      deck: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Удалить личную колоду пользователя
app.delete("/api/player-decks/:id", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(`
      DELETE FROM player_decks
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [
      req.params.id,
      req.user.id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Колода не найдена"
      });
    }

    res.json({ ok: true });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
// Получить опубликованные колоды
app.get("/api/decks", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM decks
      ORDER BY created_at DESC
    `);

    res.json({
      ok: true,
      decks: result.rows
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Опубликовать колоду
app.post("/api/decks", verifyToken, async (req, res) => {
  try {
    const {
  title,
  description,
  cards,
  preview_ids,
  deck_code
} = req.body;

    if (!title || !Array.isArray(cards) || !cards.length) {
      return res.status(400).json({
        ok: false,
        error: "Название и карты обязательны"
      });
    }

    const result = await pool.query(`
      INSERT INTO decks (
        title,
        description,
        cards,
        preview_ids,
        author_id,
        author_name,
        author_role,
        author_is_partner,
deck_code
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [
      title,
      description || "",
      JSON.stringify(cards || []),
      JSON.stringify(preview_ids || []),
      req.user.id,
      req.user.username,
      req.user.role || "user",
      !!req.user.is_partner,
deck_code || ""
    ]);

    res.json({
      ok: true,
      deck: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
app.patch("/api/decks/:id", verifyToken, async (req, res) => {
  try {
    const { title, description, deck_code } = req.body;

    const deckResult = await pool.query(
      "SELECT * FROM decks WHERE id = $1",
      [req.params.id]
    );

    if (deckResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Колода не найдена"
      });
    }

    const deck = deckResult.rows[0];
    const isOwner = Number(deck.author_id) === Number(req.user.id);
    const isAdmin = ["admin", "developer", "moderator"].includes(req.user.role);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        ok: false,
        error: "Редактировать колоду может только автор колоды"
      });
    }

    const result = await pool.query(`
  UPDATE decks
  SET title = $1,
      description = $2,
      deck_code = $3
  WHERE id = $4
  RETURNING *
`, [
  title || deck.title,
  description || "",
  deck_code || "",
  req.params.id
]);

    res.json({
      ok: true,
      deck: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
// Удалить опубликованную колоду
app.delete("/api/decks/:id", verifyToken, async (req, res) => {
  try {
    const deckResult = await pool.query(
      "SELECT * FROM decks WHERE id = $1",
      [req.params.id]
    );

    if (deckResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Колода не найдена"
      });
    }

    const deck = deckResult.rows[0];

    const isOwner = deck.author_id === req.user.id;
    const isAdmin = ["admin", "developer", "moderator"].includes(req.user.role);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        ok: false,
        error: "Недостаточно прав"
      });
    }

    await pool.query(
      "DELETE FROM decks WHERE id = $1",
      [req.params.id]
    );

    res.json({ ok: true });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
// Лайки / дизлайки колод
app.patch("/api/decks/:id/vote", verifyToken, async (req, res) => {
  try {

    const { type } = req.body;
    const deckId = req.params.id;
    const userId = req.user.id;

    if (!["up", "down"].includes(type)) {
      return res.status(400).json({
        ok:false,
        error:"Неверный тип голоса"
      });
    }

    const oldVote = await pool.query(
      `
      SELECT *
      FROM deck_votes
      WHERE deck_id = $1
      AND user_id = $2
      `,
      [deckId, userId]
    );

    if (oldVote.rows.length > 0) {

      const previousType = oldVote.rows[0].vote_type;

      if (previousType === type) {
        return res.status(400).json({
          ok:false,
          error:"Ты уже поставил эту оценку"
        });
      }

      await pool.query(
        `
        UPDATE deck_votes
        SET vote_type = $1
        WHERE deck_id = $2
        AND user_id = $3
        `,
        [type, deckId, userId]
      );

    } else {

      await pool.query(
        `
        INSERT INTO deck_votes
        (deck_id, user_id, vote_type)
        VALUES ($1,$2,$3)
        `,
        [deckId, userId, type]
      );

    }

    const counts = await pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE vote_type='up') AS likes,
        COUNT(*) FILTER (WHERE vote_type='down') AS dislikes
      FROM deck_votes
      WHERE deck_id = $1
      `,
      [deckId]
    );

    const likes = Number(counts.rows[0].likes || 0);
    const dislikes = Number(counts.rows[0].dislikes || 0);

    const updated = await pool.query(
      `
      UPDATE decks
SET title = $1,
    description = $2,
    deck_code = $3
WHERE id = $4
RETURNING *
      `,
      [likes, dislikes, deckId]
    );

    res.json({
      ok:true,
      deck: updated.rows[0]
    });

  } catch(error) {

    res.status(500).json({
      ok:false,
      error:error.message
    });

  }
});
app.listen(PORT, () => {
  
  console.log(`Сервер запущен на порту ${PORT}`);
});

});