const path = require("path");
const express = require("express");
const bcrypt = require("bcryptjs");
const { initializeDatabase, run, get, all } = require("./src/db");
const { signToken, authRequired, roleRequired } = require("./src/auth");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "QazaqCompetition API" });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ error: "Заполните имя, email и пароль" });
      return;
    }

    const normalizedRole = ["participant", "judge", "organizer", "spectator"].includes(role)
      ? role
      : "participant";

    const existing = await get("SELECT id FROM users WHERE email = ?", [email.toLowerCase()]);
    if (existing) {
      res.status(409).json({ error: "Пользователь с таким email уже существует" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const insert = await run(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
      [name, email.toLowerCase(), passwordHash, normalizedRole]
    );
    await run(
      "INSERT INTO profiles (user_id, city, favorite_category, bio) VALUES (?, ?, ?, ?)",
      [insert.id, "Казахстан", "Не выбрано", "Новый профиль пользователя QazaqCompetition"]
    );

    const user = await get("SELECT id, name, email, role, bonus_points, experience FROM users WHERE id = ?", [insert.id]);
    const token = signToken(user);

    res.status(201).json({ token, user });
  } catch (error) {
    res.status(500).json({ error: "Ошибка регистрации", details: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Введите email и пароль" });
      return;
    }

    const user = await get("SELECT * FROM users WHERE email = ?", [email.toLowerCase()]);
    if (!user) {
      res.status(401).json({ error: "Неверный email или пароль" });
      return;
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      res.status(401).json({ error: "Неверный email или пароль" });
      return;
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      bonus_points: user.bonus_points,
      experience: user.experience
    };

    res.json({ token: signToken(safeUser), user: safeUser });
  } catch (error) {
    res.status(500).json({ error: "Ошибка входа", details: error.message });
  }
});

app.get("/api/auth/me", authRequired, async (req, res) => {
  const user = await get(
    "SELECT id, name, email, role, bonus_points, experience, created_at FROM users WHERE id = ?",
    [req.user.id]
  );
  res.json(user);
});

app.get("/api/profile/me", authRequired, async (req, res) => {
  const user = await get(
    `SELECT u.id, u.name, u.email, u.role, u.bonus_points, u.experience, u.created_at,
      p.phone, p.city, p.favorite_category, p.bio, p.goals, p.avatar_url
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.id = ?`,
    [req.user.id]
  );

  const awardsCount = await get("SELECT COUNT(*) AS count FROM awards WHERE user_id = ?", [req.user.id]);
  const matchesCount = await get("SELECT COUNT(*) AS count FROM scores WHERE participant_id = ?", [req.user.id]);
  const recommendations = await all(
    "SELECT advice, weakness, created_at FROM ai_notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 3",
    [req.user.id]
  );

  res.json({
    ...user,
    awards_count: awardsCount ? awardsCount.count : 0,
    matches_count: matchesCount ? matchesCount.count : 0,
    recommendations
  });
});

app.put("/api/profile/me", authRequired, async (req, res) => {
  const { name, phone, city, favorite_category, bio, goals, avatar_url } = req.body;

  if (name && name.trim().length < 2) {
    res.status(400).json({ error: "Имя должно быть не короче 2 символов" });
    return;
  }

  if (name) {
    await run("UPDATE users SET name = ? WHERE id = ?", [name.trim(), req.user.id]);
  }

  const currentProfile = await get("SELECT user_id FROM profiles WHERE user_id = ?", [req.user.id]);
  if (!currentProfile) {
    await run("INSERT INTO profiles (user_id) VALUES (?)", [req.user.id]);
  }

  await run(
    `UPDATE profiles
     SET phone = ?, city = ?, favorite_category = ?, bio = ?, goals = ?, avatar_url = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`,
    [phone || "", city || "", favorite_category || "", bio || "", goals || "", avatar_url || "", req.user.id]
  );

  const profile = await get(
    `SELECT u.id, u.name, u.email, u.role, u.bonus_points, u.experience,
      p.phone, p.city, p.favorite_category, p.bio, p.goals, p.avatar_url
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.id = ?`,
    [req.user.id]
  );

  res.json(profile);
});

app.get("/api/competitions", async (req, res) => {
  const {
    city,
    category,
    competition_type,
    age_group,
    format,
    date,
    fee_type,
    q
  } = req.query;
  const conditions = [];
  const params = [];

  if (city) {
    conditions.push("c.city = ?");
    params.push(city);
  }
  if (category) {
    conditions.push("c.category = ?");
    params.push(category);
  }
  if (competition_type) {
    conditions.push("c.competition_type = ?");
    params.push(competition_type);
  }
  if (age_group) {
    conditions.push("c.age_group = ?");
    params.push(age_group);
  }
  if (format) {
    conditions.push("c.format = ?");
    params.push(format);
  }
  if (date) {
    conditions.push("c.start_date >= ?");
    params.push(date);
  }
  if (fee_type === "free") {
    conditions.push("c.entry_fee = 0");
  }
  if (fee_type === "paid") {
    conditions.push("c.entry_fee > 0");
  }
  if (q) {
    conditions.push("(c.title LIKE ? OR c.description LIKE ? OR c.city LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const competitions = await all(
    `SELECT c.*, u.name AS organizer_name,
      (SELECT COUNT(*) FROM competition_registrations r WHERE r.competition_id = c.id) AS participants_count
     FROM competitions c
     LEFT JOIN users u ON c.organizer_id = u.id
     ${whereSql}
     ORDER BY c.start_date ASC`,
    params
  );

  res.json(competitions);
});

app.post("/api/competitions", authRequired, roleRequired("organizer", "admin"), async (req, res) => {
  const {
    title,
    city,
    category,
    competition_type,
    age_group,
    format,
    start_date,
    entry_fee,
    description,
    image_url
  } = req.body;
  if (!title || !city || !category || !format || !start_date) {
    res.status(400).json({ error: "Заполните обязательные поля соревнования" });
    return;
  }

  const insert = await run(
    `INSERT INTO competitions (title, city, category, competition_type, age_group, format, start_date, entry_fee, description, image_url, organizer_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title,
      city,
      category,
      competition_type || "Олимпиада",
      age_group || "16+",
      format,
      start_date,
      Number(entry_fee || 0),
      description || "",
      image_url || "",
      req.user.id
    ]
  );

  const competition = await get("SELECT * FROM competitions WHERE id = ?", [insert.id]);
  res.status(201).json(competition);
});

app.put("/api/competitions/:id", authRequired, roleRequired("organizer", "admin"), async (req, res) => {
  const id = Number(req.params.id);
  const current = await get("SELECT * FROM competitions WHERE id = ?", [id]);
  if (!current) {
    res.status(404).json({ error: "Соревнование не найдено" });
    return;
  }

  if (req.user.role === "organizer" && current.organizer_id !== req.user.id) {
    res.status(403).json({ error: "Можно редактировать только свои соревнования" });
    return;
  }

  const data = {
    title: req.body.title || current.title,
    city: req.body.city || current.city,
    category: req.body.category || current.category,
    competition_type: req.body.competition_type || current.competition_type,
    age_group: req.body.age_group || current.age_group,
    format: req.body.format || current.format,
    start_date: req.body.start_date || current.start_date,
    entry_fee: req.body.entry_fee !== undefined ? Number(req.body.entry_fee) : current.entry_fee,
    status: req.body.status || current.status,
    description: req.body.description !== undefined ? req.body.description : current.description,
    image_url: req.body.image_url !== undefined ? req.body.image_url : current.image_url
  };

  await run(
    `UPDATE competitions
     SET title = ?, city = ?, category = ?, competition_type = ?, age_group = ?, format = ?, start_date = ?, entry_fee = ?, status = ?, description = ?, image_url = ?
     WHERE id = ?`,
    [
      data.title,
      data.city,
      data.category,
      data.competition_type,
      data.age_group,
      data.format,
      data.start_date,
      data.entry_fee,
      data.status,
      data.description,
      data.image_url,
      id
    ]
  );

  const updated = await get("SELECT * FROM competitions WHERE id = ?", [id]);
  res.json(updated);
});

app.delete("/api/competitions/:id", authRequired, roleRequired("organizer", "admin"), async (req, res) => {
  const id = Number(req.params.id);
  const current = await get("SELECT * FROM competitions WHERE id = ?", [id]);
  if (!current) {
    res.status(404).json({ error: "Соревнование не найдено" });
    return;
  }

  if (req.user.role === "organizer" && current.organizer_id !== req.user.id) {
    res.status(403).json({ error: "Можно удалять только свои соревнования" });
    return;
  }

  await run("DELETE FROM competitions WHERE id = ?", [id]);
  res.json({ success: true });
});

app.post("/api/competitions/:id/register", authRequired, roleRequired("participant", "admin"), async (req, res) => {
  const competitionId = Number(req.params.id);
  const competition = await get("SELECT * FROM competitions WHERE id = ?", [competitionId]);

  if (!competition) {
    res.status(404).json({ error: "Соревнование не найдено" });
    return;
  }

  try {
    await run(
      "INSERT INTO competition_registrations (competition_id, user_id) VALUES (?, ?)",
      [competitionId, req.user.id]
    );

    const bonusDelta = Math.max(10, Math.round(competition.entry_fee * 0.01));
    await run(
      "UPDATE users SET bonus_points = bonus_points + ?, experience = experience + 20 WHERE id = ?",
      [bonusDelta, req.user.id]
    );
    await run(
      "INSERT INTO bonus_transactions (user_id, amount, type, description) VALUES (?, ?, 'credit', ?)",
      [req.user.id, bonusDelta, `Бонус за регистрацию в ${competition.title}`]
    );

    res.status(201).json({ success: true, message: "Регистрация подтверждена" });
  } catch (_error) {
    res.status(409).json({ error: "Вы уже зарегистрированы на это соревнование" });
  }
});

app.get("/api/hall-of-fame/me", authRequired, async (req, res) => {
  const awards = await all("SELECT * FROM awards WHERE user_id = ? ORDER BY year DESC", [req.user.id]);
  const matches = await all(
    `SELECT m.title, m.scheduled_at, m.video_url, s.points, s.comment
     FROM scores s
     JOIN matches m ON m.id = s.match_id
     WHERE s.participant_id = ?
     ORDER BY m.scheduled_at DESC`,
    [req.user.id]
  );
  const profile = await get(
    "SELECT name, role, bonus_points, experience, created_at FROM users WHERE id = ?",
    [req.user.id]
  );

  res.json({ profile, awards, matches });
});

app.get("/api/live", async (_req, res) => {
  const items = await all(
    `SELECT m.*, c.title AS competition_title, c.city, c.category
     FROM matches m
     JOIN competitions c ON c.id = m.competition_id
     ORDER BY m.scheduled_at ASC`
  );
  res.json(items);
});

app.get("/api/bonuses/me", authRequired, async (req, res) => {
  const profile = await get("SELECT bonus_points, experience FROM users WHERE id = ?", [req.user.id]);
  const transactions = await all(
    "SELECT * FROM bonus_transactions WHERE user_id = ? ORDER BY created_at DESC",
    [req.user.id]
  );
  res.json({ profile, transactions });
});

app.get("/api/judge/matches", authRequired, roleRequired("judge", "admin"), async (req, res) => {
  const items = await all(
    `SELECT m.id, m.title, m.scheduled_at, m.status, c.title AS competition_title,
      r.user_id, u.name AS participant_name
     FROM matches m
     JOIN competitions c ON c.id = m.competition_id
     LEFT JOIN competition_registrations r ON r.competition_id = c.id
     LEFT JOIN users u ON u.id = r.user_id
     WHERE m.judge_id = ? OR ? = 'admin'
     ORDER BY m.scheduled_at ASC`,
    [req.user.id, req.user.role]
  );

  res.json(items);
});

app.post("/api/judge/score", authRequired, roleRequired("judge", "admin"), async (req, res) => {
  const { match_id, participant_id, points, comment } = req.body;
  if (!match_id || !participant_id || points === undefined) {
    res.status(400).json({ error: "Укажите match_id, participant_id и points" });
    return;
  }

  await run(
    "INSERT INTO scores (match_id, participant_id, judge_id, points, comment) VALUES (?, ?, ?, ?, ?)",
    [Number(match_id), Number(participant_id), req.user.id, Number(points), comment || ""]
  );

  await run(
    "UPDATE users SET experience = experience + ?, bonus_points = bonus_points + ? WHERE id = ?",
    [Math.round(Number(points) / 2), 15, Number(participant_id)]
  );

  res.status(201).json({ success: true });
});

app.post("/api/judge/qr-check", authRequired, roleRequired("judge", "admin"), async (req, res) => {
  const { competition_id, participant_email } = req.body;
  if (!competition_id || !participant_email) {
    res.status(400).json({ error: "Укажите competition_id и participant_email" });
    return;
  }

  const participant = await get("SELECT id, name FROM users WHERE email = ?", [participant_email.toLowerCase()]);
  if (!participant) {
    res.status(404).json({ error: "Участник не найден" });
    return;
  }

  const registration = await get(
    "SELECT id FROM competition_registrations WHERE competition_id = ? AND user_id = ?",
    [Number(competition_id), participant.id]
  );

  if (!registration) {
    res.status(404).json({ error: "Участник не зарегистрирован на это соревнование" });
    return;
  }

  await run(
    "UPDATE competition_registrations SET checked_in = 1 WHERE competition_id = ? AND user_id = ?",
    [Number(competition_id), participant.id]
  );

  res.json({ success: true, participant });
});

app.get("/api/organizer/services", authRequired, roleRequired("organizer", "admin"), async (_req, res) => {
  const items = await all("SELECT * FROM organizer_services ORDER BY category ASC, price ASC");
  res.json(items);
});

app.get("/api/organizer/competitions", authRequired, roleRequired("organizer", "admin"), async (req, res) => {
  const items = await all(
    `SELECT * FROM competitions
     WHERE organizer_id = ? OR ? = 'admin'
     ORDER BY created_at DESC`,
    [req.user.id, req.user.role]
  );
  res.json(items);
});

app.get("/api/ai/advice", authRequired, async (req, res) => {
  const competitionId = Number(req.query.competitionId);
  if (!competitionId) {
    res.status(400).json({ error: "Укажите competitionId" });
    return;
  }

  const existing = await get(
    "SELECT advice, weakness, created_at FROM ai_notes WHERE user_id = ? AND competition_id = ? ORDER BY created_at DESC LIMIT 1",
    [req.user.id, competitionId]
  );

  if (existing) {
    res.json(existing);
    return;
  }

  const competition = await get("SELECT title, category FROM competitions WHERE id = ?", [competitionId]);
  if (!competition) {
    res.status(404).json({ error: "Соревнование не найдено" });
    return;
  }

  const advice = `Подготовь 3 тренировочные сессии по категории ${competition.category}, симулируй финальный раунд и заранее проверь оборудование.`;
  const weakness = "Риск: потеря очков из-за спешки в финальном этапе. Рекомендация: чеклист и тайм-блоки.";

  await run(
    "INSERT INTO ai_notes (user_id, competition_id, advice, weakness) VALUES (?, ?, ?, ?)",
    [req.user.id, competitionId, advice, weakness]
  );

  res.json({ advice, weakness, created_at: new Date().toISOString() });
});

app.post("/api/ai/draw", authRequired, roleRequired("organizer", "admin"), async (req, res) => {
  const { competition_id } = req.body;
  if (!competition_id) {
    res.status(400).json({ error: "Укажите competition_id" });
    return;
  }

  const participants = await all(
    `SELECT u.id, u.name
     FROM competition_registrations r
     JOIN users u ON u.id = r.user_id
     WHERE r.competition_id = ?
     ORDER BY u.id ASC`,
    [Number(competition_id)]
  );

  if (participants.length < 2) {
    res.status(400).json({ error: "Для жеребьевки нужно минимум 2 участника" });
    return;
  }

  const shuffled = [...participants];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const pairs = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    if (shuffled[i + 1]) {
      pairs.push([shuffled[i].name, shuffled[i + 1].name]);
    } else {
      pairs.push([shuffled[i].name, "Проходит автоматически"]);
    }
  }

  res.json({ pairs });
});

app.get("/api/ai/chances", authRequired, async (req, res) => {
  const competitionId = Number(req.query.competitionId);
  if (!competitionId) {
    res.status(400).json({ error: "Укажите competitionId" });
    return;
  }

  const registrations = await all(
    `SELECT u.id, u.name, u.experience, COALESCE(AVG(s.points), 60) AS avg_points
     FROM competition_registrations r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN scores s ON s.participant_id = u.id
     WHERE r.competition_id = ?
     GROUP BY u.id, u.name, u.experience`,
    [competitionId]
  );

  if (!registrations.length) {
    res.json([]);
    return;
  }

  const scored = registrations.map((row) => {
    const normalized = Math.min(95, Math.round(row.avg_points * 0.7 + row.experience * 0.03));
    return {
      participant: row.name,
      winChance: Math.max(5, normalized)
    };
  });

  res.json(scored.sort((a, b) => b.winChance - a.winChance));
});

app.get("/api/ai/weakness", authRequired, async (req, res) => {
  const latestScore = await get(
    "SELECT points, comment FROM scores WHERE participant_id = ? ORDER BY created_at DESC LIMIT 1",
    [req.user.id]
  );

  if (!latestScore) {
    res.json({
      analysis: "Недостаточно данных. Заверши хотя бы один матч для персонального AI-анализа."
    });
    return;
  }

  const analysis = latestScore.points < 70
    ? "AI видит просадку в точности и стабильности. Добавь 2 контрольных тренировки на скорость принятия решений."
    : "AI отмечает хороший уровень. Для роста до топ-результата усили защиту стратегии и работу под давлением.";

  res.json({ analysis, basedOn: latestScore.comment || "последнем выступлении" });
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    next();
    return;
  }
  res.sendFile(path.join(__dirname, "index.html"));
});

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`QazaqCompetition MVP started at http://localhost:${port}`);
  });

  server.on("error", (error) => {
    if (error && error.code === "EADDRINUSE") {
      const nextPort = Number(port) + 1;
      console.warn(`Port ${port} is busy, trying ${nextPort}...`);
      startServer(nextPort);
      return;
    }
    console.error("Server failed to start", error);
    process.exit(1);
  });
}

initializeDatabase()
  .then(() => {
    startServer(PORT);
  })
  .catch((error) => {
    console.error("Failed to initialize database", error);
    process.exit(1);
  });


