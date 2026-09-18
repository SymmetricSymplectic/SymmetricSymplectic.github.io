(function () {
  var listEl = document.getElementById("archive-list");

  function tagNode(text) {
    var tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = text;
    return tag;
  }

  function itemNode(item) {
    var article = document.createElement("article");
    article.className = "doc";

    var title = document.createElement("h3");
    title.textContent = item.title;
    article.appendChild(title);

    var sourceParts = [];
    if (item.author) sourceParts.push(item.author);
    if (item.type) sourceParts.push(item.type);
    if (item.source) sourceParts.push(item.source);

    if (sourceParts.length) {
      var source = document.createElement("p");
      source.className = "doc-source";
      source.textContent = sourceParts.join(" · ");
      article.appendChild(source);
    }

    if (item.image) {
      var image = document.createElement("img");
      image.src = item.image;
      image.alt = item.title;
      article.appendChild(image);
    }

    if (item.description) {
      var description = document.createElement("p");
      description.textContent = item.description;
      article.appendChild(description);
    }

    if (item.tags && item.tags.length) {
      var tags = document.createElement("div");
      tags.className = "doc-tags";
      item.tags.forEach(function (text) {
        tags.appendChild(tagNode(text));
      });
      article.appendChild(tags);
    }

    if (item.url) {
      var link = document.createElement("a");
      link.className = "doc-link";
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Ver documento →";
      article.appendChild(link);
    }

    return article;
  }

  fetch("data/archivo.json")
    .then(function (response) {
      if (!response.ok) throw new Error(response.statusText);
      return response.json();
    })
    .then(function (data) {
      var items = data.items || [];
      var fragment = document.createDocumentFragment();
      items.forEach(function (item) {
        fragment.appendChild(itemNode(item));
      });
      listEl.appendChild(fragment);
    })
    .catch(function () {
      listEl.innerHTML =
        '<p class="muted">No se pudo cargar el archivo. Sirve el sitio por HTTP (por ejemplo GitHub Pages).</p>';
    });
})();
