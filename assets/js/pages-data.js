/* Public snapshot data and safe DOM rendering for xFunFacts Pages. */
(function () {
  'use strict';

  const slugPattern = /^[a-z0-9][a-z0-9_-]*$/;
  const normalize = text => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
  let loading;

  function load() {
    if (!loading) {
      loading = fetch('/facts-index.json').then(response => {
        if (!response.ok) throw new Error('Fact index unavailable');
        return response.json();
      }).then(data => {
        if (!data.topics || !Array.isArray(data.facts)) throw new Error('Invalid fact index');
        return {
          topics: data.topics,
          facts: data.facts.filter(fact => slugPattern.test(fact.slug)).map(fact => ({
            ...fact, searchTitle: normalize(fact.title)
          }))
        };
      }).catch(error => {
        loading = null;
        throw error;
      });
    }
    return loading;
  }

  function factUrl(slug) {
    return slugPattern.test(slug) ? '/' + slug + '/' : '/random-fun-facts/';
  }

  function search(data, query) {
    const term = normalize(query);
    if (!term) return [];
    const words = term.split(/\s+/);
    const score = fact => {
      if (fact.searchTitle.startsWith(term)) return 0;
      if (fact.searchTitle.includes(term)) return 1;
      return words.every(word => fact.searchTitle.includes(word)) ? 2 : -1;
    };
    return data.facts.map(fact => ({ fact, rank: score(fact) }))
      .filter(match => match.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.fact.title.localeCompare(b.fact.title))
      .map(match => match.fact);
  }

  function pick(data, scope, excluded, seen = new Set()) {
    const topics = (scope || 'all').split(':').filter(topic => topic !== 'all');
    const pool = data.facts.filter(fact => fact.id !== Number(excluded) &&
      topics.every(topic => fact.topics.includes(topic)));
    const fresh = pool.filter(fact => !seen.has(fact.id));
    const choices = fresh.length ? fresh : pool;
    return choices[Math.floor(Math.random() * choices.length)];
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function tagList(data, fact, small) {
    const list = element('span', 'ff-tags');
    for (const topic of fact.topics) {
      if (!Object.hasOwn(data.topics, topic)) continue;
      const name = topic === 'fun-facts-for-kids' ? 'For Kids' : data.topics[topic];
      list.append(element('span', 'ff-tag cat-' + topic + (small ? ' ff-tag--sm' : ''), name));
    }
    return list;
  }

  function setImage(img, fact, decorative) {
    img.alt = decorative ? '' : fact.alt;
    try {
      const url = new URL(fact.image);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        img.src = url.href;
        return;
      }
    } catch (error) {
      // Older articles can have no thumbnail.
    }
    img.removeAttribute('src');
  }

  function fillFeature(feature, data, fact, scope) {
    const url = factUrl(fact.slug);
    for (const name of [...feature.classList]) {
      if (name.startsWith('cat-')) feature.classList.remove(name);
    }
    if (fact.theme) feature.classList.add('cat-' + fact.theme);
    feature.dataset.ffId = fact.id;
    feature.dataset.ffSlug = fact.slug;
    feature.dataset.ffScope = scope;
    for (const link of feature.querySelectorAll('.ff-feature__title a, a.ff-feature__media, .ff-btn--primary:not([data-ff-next])')) {
      link.href = url;
    }
    const title = feature.querySelector('.ff-feature__title a');
    if (title) title.textContent = fact.title;
    const desc = feature.querySelector('.ff-feature__desc');
    if (desc) desc.textContent = fact.summary;
    const tags = feature.querySelector('.ff-tags');
    if (tags) tags.replaceChildren(...tagList(data, fact, false).childNodes);
    const img = feature.querySelector('.ff-feature__media img');
    if (img) setImage(img, fact, true);
    const note = feature.querySelector('.ff-feature__note > span');
    if (note) {
      const count = note.querySelector('[data-ff-count]');
      const names = scope.split(':').map(topic => data.topics[topic]).filter(Boolean);
      note.textContent = names.length ? 'Picking facts from ' + names.join(' and ') + '.' :
        'Every click picks a new fact from the whole collection.';
      if (count) note.append(count);
    }
    const next = feature.querySelector('[data-ff-next]');
    const fallback = pick(data, scope, fact.id);
    if (next) next.href = fallback ? factUrl(fallback.slug) : '/random-fun-facts/';
  }

  function card(data, fact, ranked = false) {
    const link = element('a', 'ff-card' + (fact.theme ? ' cat-' + fact.theme : ''));
    link.href = factUrl(fact.slug);
    link.dataset.ffCard = fact.id;
    const media = element('span', 'ff-card__media');
    const image = element('img');
    image.width = 800;
    image.height = 450;
    image.loading = 'lazy';
    image.decoding = 'async';
    setImage(image, fact, false);
    media.append(image);
    const meta = element('span', 'ff-card__meta');
    if (ranked) meta.append(element('span', 'ff-card__num'));
    const read = element('span', 'ff-card__read', 'Read');
    read.hidden = true;
    meta.append(read);
    link.append(media, meta, element('h3', 'ff-card__title', fact.title), tagList(data, fact, true));
    return link;
  }

  window.FunFactsPages = { load, factUrl, search, pick, fillFeature, card };
}());
