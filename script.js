const API_BASE = (() => {
  const { protocol, hostname, port } = window.location;
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";

  if (protocol === "file:") {
    return "http://localhost:3000/api";
  }

  if (isLocalHost && port && port !== "3000") {
    return "http://localhost:3000/api";
  }

  return "/api";
})();
function getToken() {
  return localStorage.getItem("qc_token") || "";
}

function setToken(token) {
  localStorage.setItem("qc_token", token);
}

function clearToken() {
  localStorage.removeItem("qc_token");
  localStorage.removeItem("qc_user");
}

function setUser(user) {
  localStorage.setItem("qc_user", JSON.stringify(user));
}

function getUser() {
  const raw = localStorage.getItem("qc_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    if (data && data.error) {
      throw new Error(data.error);
    }
    if (response.status === 0) {
      throw new Error("Нет соединения с API");
    }
    if (response.status === 404) {
      throw new Error("API не найдено (проверь, что сервер запущен через npm start)");
    }
    if (response.status === 500) {
      throw new Error("Внутренняя ошибка сервера (проверь консоль Node.js)");
    }
    throw new Error(`Ошибка запроса (${response.status})`);
  }

  return data;
}

function showMessage(containerId, text, isError = false) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.textContent = text;
  el.className = isError ? "notice notice-error" : "notice notice-success";
}

function hideMessage(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.textContent = "";
  el.className = "notice";
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU", { year: "numeric", month: "short", day: "numeric" });
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₸`;
}

function competitionMeta(item) {
  const baseTime = item.format === "Онлайн" ? "19:00-21:00" : item.format === "Гибрид" ? "15:00-20:00" : "10:00-18:00";
  const prizeFund = Math.max(50000, Number(item.entry_fee || 0) * 40);
  const quota = item.format === "Онлайн" ? 500 : item.format === "Гибрид" ? 240 : 120;
  const venue = item.format === "Онлайн" ? "Онлайн-платформа QazaqCompetition" : `${item.city}, центральная площадка`;
  return { baseTime, prizeFund, quota, venue };
}

function roleLabel(role) {
  const map = {
    participant: "Участник",
    judge: "Судья",
    organizer: "Организатор",
    spectator: "Зритель",
    admin: "Админ"
  };
  return map[role] || role;
}

function roleHomePath(role) {
  const map = {
    participant: "competitions.html",
    judge: "judge-panel.html",
    organizer: "organizer-panel.html",
    spectator: "live.html",
    admin: "profile.html"
  };
  return map[role] || "index.html";
}

function applyRoleNavigation(user) {
  const links = document.querySelectorAll(".nav a");
  if (!links.length) return;

  const visibility = {
    "judge-panel.html": user && ["judge", "admin"].includes(user.role),
    "organizer-panel.html": user && ["organizer", "admin"].includes(user.role),
    "bonuses.html": user && ["participant", "admin", "spectator", "judge", "organizer"].includes(user.role),
    "hall-of-fame.html": user && ["participant", "admin", "judge", "organizer", "spectator"].includes(user.role),
    "profile.html": Boolean(user)
  };

  links.forEach((link) => {
    const href = (link.getAttribute("href") || "").trim();
    if (visibility[href] === undefined) return;
    link.style.display = visibility[href] ? "inline-flex" : "none";
  });
}

function guardRolePage(user) {
  const path = window.location.pathname.split("/").pop() || "index.html";
  const protectedPages = {
    "judge-panel.html": ["judge", "admin"],
    "organizer-panel.html": ["organizer", "admin"],
    "bonuses.html": ["participant", "judge", "organizer", "spectator", "admin"],
    "hall-of-fame.html": ["participant", "judge", "organizer", "spectator", "admin"],
    "profile.html": ["participant", "judge", "organizer", "spectator", "admin"]
  };

  const allowed = protectedPages[path];
  if (!allowed) return;

  if (!user) {
    window.location.href = "login.html";
    return;
  }

  if (!allowed.includes(user.role)) {
    window.location.href = roleHomePath(user.role);
  }
}

function injectAuthControls() {
  const mount = document.getElementById("auth-controls");
  if (!mount) return;

  const user = getUser();
  if (!user) {
    mount.innerHTML = `
      <a href="login.html" class="button tiny ghost">Вход</a>
      <a href="register.html" class="button tiny">Регистрация</a>
    `;
    applyRoleNavigation(null);
    return;
  }

  mount.innerHTML = `
    <div class="user-chip">
      <span>${user.name}</span>
      <small>${roleLabel(user.role)}</small>
    </div>
    <button class="button tiny ghost" id="logout-btn" type="button">Выйти</button>
  `;

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      clearToken();
      window.location.href = "index.html";
    });
  }

  applyRoleNavigation(user);
}

async function refreshUser() {
  if (!getToken()) return null;
  try {
    const user = await api("/auth/me");
    setUser(user);
    return user;
  } catch (_error) {
    clearToken();
    return null;
  }
}

async function setupAuthPage() {
  const registerForm = document.getElementById("register-form");
  const loginForm = document.getElementById("login-form");

  if (registerForm) {
    registerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      hideMessage("auth-message");

      const payload = Object.fromEntries(new FormData(registerForm).entries());
      try {
        const data = await api("/auth/register", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        setToken(data.token);
        setUser(data.user);
        showMessage("auth-message", "Регистрация успешна. Профиль создан автоматически.");
        setTimeout(() => {
          window.location.href = "profile.html";
        }, 700);
      } catch (error) {
        showMessage("auth-message", error.message, true);
      }
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      hideMessage("auth-message");

      const payload = Object.fromEntries(new FormData(loginForm).entries());
      try {
        const data = await api("/auth/login", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        setToken(data.token);
        setUser(data.user);
        showMessage("auth-message", "Вход выполнен.");
        setTimeout(() => {
          window.location.href = roleHomePath(data.user.role);
        }, 700);
      } catch (error) {
        showMessage("auth-message", error.message, true);
      }
    });
  }
}

async function setupCompetitionsPage() {
  const list = document.getElementById("competitions-list");
  if (!list) return;

  const searchForm = document.getElementById("search-form");
  const searchInput = document.getElementById("search-input");
  const form = document.getElementById("filters-form");
  const openFiltersBtn = document.getElementById("open-filters-btn");
  const closeFiltersBtn = document.getElementById("close-filters-btn");
  const resetFiltersBtn = document.getElementById("reset-filters-btn");
  const quickCards = document.querySelectorAll(".quick-example-card");
  const filterModal = document.getElementById("filter-modal");
  const filterOverlay = document.getElementById("filter-overlay");

  const filters = {
    q: "",
    city: "",
    category: "",
    competition_type: "",
    age_group: "",
    format: "",
    date: "",
    fee_type: "",
    sort: "date_asc"
  };

  function toggleFilterModal(show) {
    if (!filterModal) return;
    filterModal.classList.toggle("open", show);
    filterModal.setAttribute("aria-hidden", show ? "false" : "true");
  }

  async function loadCompetitions() {
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (!value || key === "sort") return;
        params.set(key, value);
      });

      const data = await api(`/competitions${params.toString() ? `?${params.toString()}` : ""}`);
      let items = [...data];

      if (filters.sort === "date_desc") {
        items.sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
      } else if (filters.sort === "fee_asc") {
        items.sort((a, b) => Number(a.entry_fee) - Number(b.entry_fee));
      } else if (filters.sort === "fee_desc") {
        items.sort((a, b) => Number(b.entry_fee) - Number(a.entry_fee));
      } else if (filters.sort === "popular") {
        items.sort((a, b) => Number(b.participants_count) - Number(a.participants_count));
      } else {
        items.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
      }

      if (!items.length) {
        list.innerHTML = `<p class="muted">По этим фильтрам соревнования не найдены.</p>`;
        return;
      }

      list.innerHTML = items
        .map((item) => {
          const meta = competitionMeta(item);
          return `
          <article class="card competition-card">
            <img src="${item.image_url || "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=900&q=80"}" alt="${item.title}" class="card-photo" />
            <div class="card-body">
              <h3>${item.title}</h3>
              <p>${item.description || "Описание пока не добавлено"}</p>
              <div class="meta-table">
                <div><span class="meta-label">Время проведения</span><strong>${formatDate(item.start_date)} • ${meta.baseTime}</strong></div>
                <div><span class="meta-label">Краткое описание</span><strong>${(item.description || "Описание пока не добавлено").slice(0, 84)}</strong></div>
                <div><span class="meta-label">Призовой фонд</span><strong>${formatMoney(meta.prizeFund)}</strong></div>
                <div><span class="meta-label">Квота участников</span><strong>${meta.quota} мест</strong></div>
                <div><span class="meta-label">Площадка</span><strong>${meta.venue}</strong></div>
                <div><span class="meta-label">Стоимость участия</span><strong>${Number(item.entry_fee) === 0 ? "Бесплатно" : formatMoney(item.entry_fee)}</strong></div>
              </div>
              <div class="meta-row">
                <span>${item.city}</span>
                <span>${item.category}</span>
                <span>${item.competition_type || "Олимпиада"}</span>
                <span>${item.age_group || "16+"}</span>
                <span>${item.format}</span>
                <span>Участников: ${item.participants_count}</span>
              </div>
              <div class="actions-row">
                <button class="button tiny register-btn" data-id="${item.id}" type="button">Зарегистрироваться</button>
                <button class="button tiny ghost advice-btn" data-id="${item.id}" type="button">AI-совет</button>
                <button class="button tiny ghost chance-btn" data-id="${item.id}" type="button">AI-шансы</button>
              </div>
              <div id="ai-result-${item.id}" class="inline-note"></div>
            </div>
          </article>
        `;
        })
        .join("");

      document.querySelectorAll(".register-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await api(`/competitions/${btn.dataset.id}/register`, { method: "POST" });
            showMessage("competition-message", "Вы успешно зарегистрированы.");
            loadCompetitions();
          } catch (error) {
            showMessage("competition-message", error.message, true);
          }
        });
      });

      document.querySelectorAll(".advice-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const target = document.getElementById(`ai-result-${btn.dataset.id}`);
          try {
            const dataAdvice = await api(`/ai/advice?competitionId=${btn.dataset.id}`);
            target.textContent = `AI: ${dataAdvice.advice} | ${dataAdvice.weakness}`;
          } catch (error) {
            target.textContent = error.message;
          }
        });
      });

      document.querySelectorAll(".chance-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const target = document.getElementById(`ai-result-${btn.dataset.id}`);
          try {
            const dataChances = await api(`/ai/chances?competitionId=${btn.dataset.id}`);
            if (!dataChances.length) {
              target.textContent = "AI: пока недостаточно данных по участникам.";
              return;
            }
            const top = dataChances.slice(0, 3).map((x) => `${x.participant}: ${x.winChance}%`).join(" | ");
            target.textContent = `AI-шансы: ${top}`;
          } catch (error) {
            target.textContent = error.message;
          }
        });
      });
    } catch (error) {
      list.innerHTML = `<p class="notice notice-error">${error.message}</p>`;
    }
  }

  if (openFiltersBtn) {
    openFiltersBtn.addEventListener("click", () => toggleFilterModal(true));
  }

  if (closeFiltersBtn) {
    closeFiltersBtn.addEventListener("click", () => toggleFilterModal(false));
  }

  if (filterOverlay) {
    filterOverlay.addEventListener("click", () => toggleFilterModal(false));
  }

  if (searchForm) {
    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      filters.q = (searchInput && searchInput.value ? searchInput.value : "").trim();
      loadCompetitions();
    });
  }

  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      Object.assign(filters, values);
      filters.q = (searchInput && searchInput.value ? searchInput.value : "").trim();
      toggleFilterModal(false);
      loadCompetitions();
    });
  }

  if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener("click", () => {
      if (form) form.reset();
      if (searchInput) searchInput.value = "";
      filters.city = "";
      filters.category = "";
      filters.competition_type = "";
      filters.age_group = "";
      filters.format = "";
      filters.date = "";
      filters.fee_type = "";
      filters.sort = "date_asc";
      filters.q = "";
      toggleFilterModal(false);
      loadCompetitions();
    });
  }

  if (quickCards.length) {
    quickCards.forEach((card) => {
      card.addEventListener("click", () => {
        filters.q = card.dataset.q || "";
        filters.city = card.dataset.city || "";
        filters.competition_type = card.dataset.type || "";
        filters.age_group = card.dataset.age || "";
        filters.fee_type = card.dataset.fee || "";
        filters.category = "";
        filters.date = "";
        filters.format = "";
        filters.sort = "date_asc";

        if (searchInput) {
          searchInput.value = filters.q;
        }

        if (form) {
          form.city.value = filters.city;
          form.competition_type.value = filters.competition_type;
          form.age_group.value = filters.age_group;
          form.fee_type.value = filters.fee_type;
          form.category.value = "";
          form.date.value = "";
          form.format.value = "";
          form.sort.value = "date_asc";
        }

        loadCompetitions();
      });
    });
  }

  loadCompetitions();
}

async function setupHallOfFamePage() {
  const mount = document.getElementById("hall-content");
  if (!mount) return;

  try {
    const data = await api("/hall-of-fame/me");
    mount.innerHTML = `
      <div class="stats-grid">
        <article class="card"><h3>${data.profile.name}</h3><p>Роль: ${roleLabel(data.profile.role)}</p></article>
        <article class="card"><h3>${data.profile.experience}</h3><p>Опыт (XP)</p></article>
        <article class="card"><h3>${data.profile.bonus_points}</h3><p>Бонусные баллы</p></article>
      </div>

      <section class="panel">
        <h2>Награды</h2>
        <div class="list-grid">
          ${data.awards.length ? data.awards.map((a) => `<article class="card"><h3>${a.title}</h3><p>${a.competition_name}, ${a.year}</p></article>`).join("") : '<p class="muted">Награды пока не добавлены.</p>'}
        </div>
      </section>

      <section class="panel">
        <h2>История матчей</h2>
        <div class="list-grid">
          ${data.matches.length ? data.matches.map((m) => `<article class="card"><h3>${m.title}</h3><p>${formatDate(m.scheduled_at)} | Баллы: ${m.points}</p><p>${m.comment || "Без комментария"}</p><a class="button tiny ghost" href="${m.video_url || '#'}" target="_blank" rel="noreferrer">Пересмотреть</a></article>`).join("") : '<p class="muted">История матчей пока пустая.</p>'}
        </div>
      </section>
    `;
  } catch (error) {
    mount.innerHTML = `<p class="notice notice-error">${error.message}</p>`;
  }
}

async function setupLivePage() {
  const mount = document.getElementById("live-list");
  const featuredMount = document.getElementById("live-featured");
  const liveCountMount = document.getElementById("live-now-count");
  if (!mount) return;

  try {
    const items = await api("/live");
    const normalized = items.map((item) => ({
      ...item,
      status: String(item.status || "").toLowerCase()
    }));
    const liveItems = normalized.filter((item) => item.status === "live");
    const featured = liveItems[0] || normalized[0];

    if (liveCountMount) {
      liveCountMount.textContent = `${liveItems.length} каналов live`;
    }

    if (!items.length) {
      if (featuredMount) {
        featuredMount.innerHTML = '<p class="muted">Главный эфир появится после добавления матчей.</p>';
      }
      mount.innerHTML = '<p class="muted">Эфиры и записи пока не добавлены.</p>';
      return;
    }

    if (featuredMount && featured) {
      const featuredStatusClass = featured.status === "live" ? "is-live" : featured.status === "scheduled" ? "is-scheduled" : "is-finished";
      const featuredStatusLabel = featured.status === "live" ? "LIVE" : featured.status === "scheduled" ? "СКОРО" : "ЗАПИСЬ";
      featuredMount.innerHTML = `
        <article class="live-stage">
          <div class="live-stage-media">
            <span class="live-status ${featuredStatusClass}">${featuredStatusLabel}</span>
            <img src="https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1400&q=80" alt="${featured.title}" />
          </div>
          <div class="live-stage-content">
            <h2>${featured.title}</h2>
            <p>${featured.competition_title} | ${featured.city} | ${featured.category}</p>
            <p>${formatDate(featured.scheduled_at)} | Статус: ${featured.status}</p>
            <div class="actions-row">
              <a class="button tiny" href="${featured.live_url || "#"}" target="_blank" rel="noreferrer">Смотреть live</a>
              <a class="button tiny ghost" href="${featured.video_url || "#"}" target="_blank" rel="noreferrer">Открыть запись</a>
            </div>
          </div>
        </article>
      `;
    }

    mount.innerHTML = normalized
      .map(
        (item) => {
          const statusClass = item.status === "live" ? "is-live" : item.status === "scheduled" ? "is-scheduled" : "is-finished";
          const statusLabel = item.status === "live" ? "LIVE" : item.status === "scheduled" ? "СКОРО" : "ЗАПИСЬ";
          return `
        <article class="card video-card twitch-card">
          <div class="video-thumb">
            <span class="live-status ${statusClass}">${statusLabel}</span>
            <img src="https://images.unsplash.com/photo-1560253023-3ec5d502959f?auto=format&fit=crop&w=900&q=80" alt="${item.title}" class="card-photo" />
          </div>
          <h3>${item.title}</h3>
          <p>${item.competition_title} | ${item.city}</p>
          <p>${formatDate(item.scheduled_at)} | ${item.category}</p>
          <div class="actions-row">
            <a class="button tiny" href="${item.live_url || '#'}" target="_blank" rel="noreferrer">Смотреть live</a>
            <a class="button tiny ghost" href="${item.video_url || '#'}" target="_blank" rel="noreferrer">Открыть запись</a>
          </div>
        </article>
      `;
        }
      )
      .join("");
  } catch (error) {
    if (featuredMount) {
      featuredMount.innerHTML = "";
    }
    mount.innerHTML = `<p class="notice notice-error">${error.message}</p>`;
  }
}

async function setupBonusesPage() {
  const mount = document.getElementById("bonuses-content");
  if (!mount) return;

  try {
    const data = await api("/bonuses/me");
    const rows = data.transactions
      .map(
        (item) => `
        <tr>
          <td>${formatDate(item.created_at)}</td>
          <td>${item.description}</td>
          <td class="${item.amount >= 0 ? "plus" : "minus"}">${item.amount > 0 ? "+" : ""}${item.amount}</td>
        </tr>
      `
      )
      .join("");

    mount.innerHTML = `
      <div class="stats-grid">
        <article class="card"><h3>${data.profile.bonus_points}</h3><p>Текущий бонусный баланс</p></article>
        <article class="card"><h3>${data.profile.experience}</h3><p>Текущий опыт</p></article>
      </div>
      <section class="panel">
        <h2>История начислений и списаний</h2>
        <table class="table">
          <thead><tr><th>Дата</th><th>Операция</th><th>Баллы</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="3">Операций пока нет</td></tr>'}</tbody>
        </table>
      </section>
    `;
  } catch (error) {
    mount.innerHTML = `<p class="notice notice-error">${error.message}</p>`;
  }
}

async function setupJudgePage() {
  const matchesMount = document.getElementById("judge-matches");
  const scoreForm = document.getElementById("judge-score-form");
  const qrForm = document.getElementById("judge-qr-form");

  if (!matchesMount) return;

  async function loadMatches() {
    try {
      const items = await api("/judge/matches");
      matchesMount.innerHTML = items.length
        ? items
            .map(
              (item) => `<article class="card"><h3>${item.title}</h3><p>${item.competition_title}</p><p>${formatDate(item.scheduled_at)} | ${item.status}</p><p>Участник: ${item.participant_name || "ожидается"}</p></article>`
            )
            .join("")
        : '<p class="muted">Матчи не назначены.</p>';
    } catch (error) {
      matchesMount.innerHTML = `<p class="notice notice-error">${error.message}</p>`;
    }
  }

  if (scoreForm) {
    scoreForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const payload = Object.fromEntries(new FormData(scoreForm).entries());
        await api("/judge/score", { method: "POST", body: JSON.stringify(payload) });
        showMessage("judge-message", "Оценка сохранена");
        scoreForm.reset();
      } catch (error) {
        showMessage("judge-message", error.message, true);
      }
    });
  }

  if (qrForm) {
    qrForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const payload = Object.fromEntries(new FormData(qrForm).entries());
        await api("/judge/qr-check", { method: "POST", body: JSON.stringify(payload) });
        showMessage("judge-message", "QR-проверка пройдена, участник отмечен");
        qrForm.reset();
      } catch (error) {
        showMessage("judge-message", error.message, true);
      }
    });
  }

  loadMatches();
}

async function setupOrganizerPage() {
  const listMount = document.getElementById("organizer-list");
  const servicesMount = document.getElementById("services-list");
  const createForm = document.getElementById("competition-create-form");
  const drawForm = document.getElementById("draw-form");

  if (!listMount) return;

  async function loadOrganizerData() {
    try {
      const [competitions, services] = await Promise.all([
        api("/organizer/competitions"),
        api("/organizer/services")
      ]);

      listMount.innerHTML = competitions.length
        ? competitions
            .map(
              (item) => `<article class="card"><h3>${item.title}</h3><p>${item.city} | ${item.category} | ${item.format}</p><p>${formatDate(item.start_date)} | ${item.entry_fee} ₸</p><p>${item.description || "Без описания"}</p></article>`
            )
            .join("")
        : '<p class="muted">Пока нет созданных соревнований.</p>';

      servicesMount.innerHTML = services
        .map((s) => `<article class="card"><h3>${s.name}</h3><p>${s.category}</p><p>${s.price} ₸ ${s.unit}</p></article>`)
        .join("");
    } catch (error) {
      listMount.innerHTML = `<p class="notice notice-error">${error.message}</p>`;
      if (servicesMount) {
        servicesMount.innerHTML = "";
      }
    }
  }

  if (createForm) {
    createForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const payload = Object.fromEntries(new FormData(createForm).entries());
        await api("/competitions", { method: "POST", body: JSON.stringify(payload) });
        showMessage("organizer-message", "Соревнование создано");
        createForm.reset();
        loadOrganizerData();
      } catch (error) {
        showMessage("organizer-message", error.message, true);
      }
    });
  }

  if (drawForm) {
    drawForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const payload = Object.fromEntries(new FormData(drawForm).entries());
        const draw = await api("/ai/draw", { method: "POST", body: JSON.stringify(payload) });
        const text = draw.pairs.map((pair, idx) => `${idx + 1}. ${pair[0]} vs ${pair[1]}`).join(" | ");
        showMessage("organizer-message", `Жеребьевка: ${text}`);
      } catch (error) {
        showMessage("organizer-message", error.message, true);
      }
    });
  }

  loadOrganizerData();
}

async function setupHomeAiWidget() {
  const mount = document.getElementById("home-ai-analysis");
  if (!mount) return;

  try {
    const data = await api("/ai/weakness");
    mount.textContent = data.analysis;
  } catch (error) {
    mount.textContent = "Войди в аккаунт, чтобы получить персональный AI-анализ.";
  }
}

async function setupProfilePage() {
  const form = document.getElementById("profile-form");
  const mount = document.getElementById("profile-overview");
  if (!form || !mount) return;

  async function loadProfile() {
    try {
      const data = await api("/profile/me");

      form.name.value = data.name || "";
      form.phone.value = data.phone || "";
      form.city.value = data.city || "";
      form.favorite_category.value = data.favorite_category || "";
      form.avatar_url.value = data.avatar_url || "";
      form.bio.value = data.bio || "";
      form.goals.value = data.goals || "";

      mount.innerHTML = `
        <div class="profile-head">
          <img src="${data.avatar_url || "https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=500&q=80"}" alt="${data.name}" class="avatar" />
          <div>
            <h2>${data.name}</h2>
            <p>${roleLabel(data.role)} | ${data.email}</p>
            <p>Город: ${data.city || "Не указан"} | Любимая категория: ${data.favorite_category || "Не выбрана"}</p>
          </div>
        </div>
        <div class="stats-grid">
          <article class="card"><h3>${data.experience}</h3><p>Опыт (XP)</p></article>
          <article class="card"><h3>${data.bonus_points}</h3><p>Бонусы</p></article>
          <article class="card"><h3>${data.awards_count}</h3><p>Награды</p></article>
        </div>
        <div class="stats-grid">
          <article class="card"><h3>${data.matches_count}</h3><p>Матчи в истории</p></article>
          <article class="card"><h3>${data.recommendations.length}</h3><p>AI-рекомендации</p></article>
          <article class="card"><h3>${formatDate(data.created_at)}</h3><p>Дата регистрации</p></article>
        </div>
      `;

      const aiMount = document.getElementById("profile-ai-list");
      if (aiMount) {
        aiMount.innerHTML = data.recommendations.length
          ? data.recommendations
              .map((x) => `<article class="card"><p><strong>Совет:</strong> ${x.advice}</p><p><strong>Фокус:</strong> ${x.weakness}</p></article>`)
              .join("")
          : '<p class="muted">AI-рекомендации появятся после взаимодействия с соревнованиями.</p>';
      }
    } catch (error) {
      mount.innerHTML = `<p class="notice notice-error">${error.message}</p>`;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideMessage("profile-message");

    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      const updated = await api("/profile/me", {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      setUser({
        ...(getUser() || {}),
        name: updated.name,
        role: updated.role,
        email: updated.email,
        bonus_points: updated.bonus_points,
        experience: updated.experience
      });
      injectAuthControls();
      showMessage("profile-message", "Профиль обновлен");
      loadProfile();
    } catch (error) {
      showMessage("profile-message", error.message, true);
    }
  });

  await loadProfile();
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = await refreshUser();
  guardRolePage(user);
  injectAuthControls();

  await Promise.all([
    setupAuthPage(),
    setupCompetitionsPage(),
    setupHallOfFamePage(),
    setupLivePage(),
    setupBonusesPage(),
    setupJudgePage(),
    setupOrganizerPage(),
    setupHomeAiWidget(),
    setupProfilePage()
  ]);
});

