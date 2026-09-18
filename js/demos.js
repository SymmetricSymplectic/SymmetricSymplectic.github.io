(function () {
  var listEl = document.getElementById("demo-list");

  function cardNode(demo) {
    var article = document.createElement("article");
    article.className = "doc";

    var title = document.createElement("h3");
    var link = document.createElement("a");
    link.href = demo.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = demo.title;
    title.appendChild(link);
    article.appendChild(title);

    if (demo.description) {
      var description = document.createElement("p");
      description.textContent = demo.description;
      article.appendChild(description);
    }

    if (demo.tags && demo.tags.length) {
      var tags = document.createElement("div");
      tags.className = "doc-tags";
      demo.tags.forEach(function (text) {
        var tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = text;
        tags.appendChild(tag);
      });
      article.appendChild(tags);
    }

    var open = document.createElement("a");
    open.className = "doc-link";
    open.href = demo.url;
    open.target = "_blank";
    open.rel = "noopener";
    open.textContent = "Abrir demo →";
    article.appendChild(open);

    return article;
  }

  fetch("data/demos.json")
    .then(function (response) {
      if (!response.ok) throw new Error(response.statusText);
      return response.json();
    })
    .then(function (data) {
      var demos = data.demos || [];
      var fragment = document.createDocumentFragment();
      demos.forEach(function (demo) {
        fragment.appendChild(cardNode(demo));
      });
      listEl.innerHTML = "";
      listEl.appendChild(fragment);
    })
    .catch(function () {
      listEl.innerHTML =
        '<p class="muted">No se pudieron cargar los demos. Sirve el sitio por HTTP (por ejemplo GitHub Pages).</p>';
    });
})();
