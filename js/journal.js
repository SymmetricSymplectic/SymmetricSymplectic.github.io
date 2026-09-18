(function () {
  var listEl = document.getElementById("journal-list");
  var countEl = document.getElementById("journal-count");
  var searchEl = document.getElementById("journal-search");
  var filterEls = document.querySelectorAll(".filter");

  var LABELS = {
    juego: "Juego",
    "película": "Película",
    serie: "Serie",
    anime: "Anime"
  };

  var entries = [];
  var medium = "todos";
  var query = "";

  function matches(entry) {
    if (medium !== "todos" && entry.medium !== medium) return false;
    if (!query) return true;
    var haystack = (entry.title + " " + (entry.note || "")).toLowerCase();
    return haystack.indexOf(query.toLowerCase()) !== -1;
  }

  function entryNode(entry) {
    var li = document.createElement("li");
    li.className = "entry";

    var title = document.createElement("div");
    title.className = "entry-title";
    title.textContent = entry.title;
    li.appendChild(title);

    var meta = document.createElement("div");
    meta.className = "entry-meta";

    var tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = LABELS[entry.medium] || entry.medium;
    meta.appendChild(tag);

    if (entry.era) {
      var era = document.createElement("span");
      era.className = "tag tag-era";
      era.textContent = entry.era;
      meta.appendChild(era);
    }

    if (entry.years) {
      var years = document.createElement("span");
      years.textContent = entry.years;
      meta.appendChild(years);
    }

    if (entry.status && entry.status !== "completado") {
      var status = document.createElement("span");
      status.className = "status-" + entry.status;
      status.textContent = entry.status;
      meta.appendChild(status);
    }

    if (entry.rating) {
      var rating = document.createElement("span");
      rating.textContent = "★".repeat(entry.rating) + "☆".repeat(5 - entry.rating);
      meta.appendChild(rating);
    }

    li.appendChild(meta);

    if (entry.note) {
      var note = document.createElement("p");
      note.className = "entry-note";
      note.textContent = entry.note;
      li.appendChild(note);
    }

    return li;
  }

  function render() {
    var filtered = entries
      .filter(matches)
      .sort(function (a, b) {
        return a.title.localeCompare(b.title, "es", { sensitivity: "base" });
      });

    listEl.innerHTML = "";

    if (countEl) {
      countEl.textContent =
        filtered.length + (filtered.length === 1 ? " entrada" : " entradas");
    }

    if (!filtered.length) {
      var empty = document.createElement("li");
      empty.className = "entry muted";
      empty.textContent = "Sin resultados.";
      listEl.appendChild(empty);
      return;
    }

    var fragment = document.createDocumentFragment();
    filtered.forEach(function (entry) {
      fragment.appendChild(entryNode(entry));
    });
    listEl.appendChild(fragment);
  }

  Array.prototype.forEach.call(filterEls, function (button) {
    button.addEventListener("click", function () {
      medium = button.getAttribute("data-medium");
      Array.prototype.forEach.call(filterEls, function (other) {
        other.setAttribute("aria-pressed", String(other === button));
      });
      render();
    });
  });

  if (searchEl) {
    searchEl.addEventListener("input", function (event) {
      query = event.target.value;
      render();
    });
  }

  fetch("data/journal.json")
    .then(function (response) {
      if (!response.ok) throw new Error(response.statusText);
      return response.json();
    })
    .then(function (data) {
      entries = data.entries || [];
      render();
    })
    .catch(function () {
      listEl.innerHTML =
        '<li class="entry muted">No se pudo cargar el journal. Sirve el sitio por HTTP (por ejemplo GitHub Pages).</li>';
    });
})();
