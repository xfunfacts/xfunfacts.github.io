/* ═══════════════════════════════════════════
   Fun Facts – Shared Script (jQuery như PFP — ADR-019; hành vi theo thiết kế ADR-020)
   ═══════════════════════════════════════════ */

$(function () {

  var pages = window.FunFactsPages;

  // ── Tìm kiếm có gợi ý — combobox ARIA: từ 2 ký tự, chờ 200 ms, ↑/↓ chọn, Enter, Esc ──
  // Thuộc tính ARIA gắn bằng JS để không đụng markup header; lỗi AJAX → đóng hộp, không báo.
  (function () {
    var $input = $('#globalSearch');
    var $drop = $('#searchSuggest');
    if (!$input.length || !$drop.length) return;
    var listId = 'searchSuggestList';
    var timer = null, revision = 0, items = [], active = -1;

    $input.attr({ role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId });

    function close() {
      revision++;
      clearTimeout(timer);
      $drop.hide().empty();
      items = [];
      active = -1;
      $input.attr('aria-expanded', 'false').removeAttr('aria-activedescendant');
    }

    function setActive(i) {
      var $opts = $drop.find('[role="option"][data-url]').attr('aria-selected', 'false');
      active = i;
      var $o = $opts.eq(i).attr('aria-selected', 'true');
      $input.attr('aria-activedescendant', $o.attr('id'));
    }

    function render(list) {
      items = $.isArray(list) ? list.slice(0, 8) : [];
      active = -1;
      var $ul = $('<ul class="ff-suggest" role="listbox"></ul>').attr('id', listId);
      if (!items.length) {
        $('<li class="ff-suggest__empty" role="option" aria-disabled="true"></li>')
          .text('No matches — press Enter to search').appendTo($ul);
      }
      $.each(items, function (i, s) {
        $('<li class="ff-suggest__option" role="option" aria-selected="false"></li>')
          .attr({ id: listId + '-' + i, 'data-url': s.url }).text(s.name).appendTo($ul);
      });
      $drop.empty().append($ul).show();
      $input.attr('aria-expanded', 'true').removeAttr('aria-activedescendant');
    }

    $input.on('input', function () {
      var q = $.trim($input.val());
      clearTimeout(timer);
      var requested = ++revision;
      if (q.length < 2) { close(); return; }
      timer = setTimeout(function () {
        pages.load().then(function (data) {
          if (revision !== requested) return;
          render(pages.search(data, q).slice(0, 8).map(function (fact) {
            return { name: fact.title, url: pages.factUrl(fact.slug) };
          }));
        }).catch(function () {
          if (revision === requested) close();
        });
      }, 200);
    });

    $input.on('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!items.length) return;
        e.preventDefault();
        var n = items.length;
        setActive(e.key === 'ArrowDown' ? (active + 1) % n : (active < 0 ? n - 1 : (active - 1 + n) % n));
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        window.location.href = items[active].url;
      } else if (e.key === 'Escape') {
        close();
      }
      // Enter khi chưa chọn gợi ý: form GET /search?q= như thường
    });

    $drop.on('mousedown', '[role="option"][data-url]', function (e) {
      e.preventDefault();
      window.location.href = $(this).attr('data-url');
    });

    $(document).on('click', function (e) {
      if (!$(e.target).closest('.nav-search').length) close();
    });
  })();

  // ── Header iPad / mobile (thiết kế §13): nút tìm kiếm mở hàng tìm kiếm, nút menu mở menu xổ; mở cái này thì đóng cái kia, Esc đóng ──
  var $header = $('.ff-header');
  function setPanel(name, open) {
    var $btn = $('[data-ff-toggle="' + name + '"]').attr('aria-expanded', open ? 'true' : 'false');
    if (name === 'search') {
      $header.toggleClass('is-search-open', open);
      if (open) $('#globalSearch').trigger('focus');
    } else {
      $('#ffMenu').prop('hidden', !open);
      $btn.find('i').first().attr('class', 'ph-fill ' + (open ? 'ph-x' : 'ph-list'));
    }
  }
  $(document).on('click', '[data-ff-toggle]', function () {
    var name = $(this).attr('data-ff-toggle');
    var open = $(this).attr('aria-expanded') !== 'true';
    setPanel(name === 'search' ? 'menu' : 'search', false);
    setPanel(name, open);
  });
  $(document).on('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var $open = $('[data-ff-toggle][aria-expanded="true"]').filter(':visible').first();
    if (!$open.length) return;
    setPanel($open.attr('data-ff-toggle'), false);
    $open.trigger('focus');
  });

  // ═══ Dữ liệu người xem chỉ ở trình duyệt — ADR-013 (khoá ff_*) ═══
  var HISTORY_KEY = 'ff_history', SAVED_KEY = 'ff_saved', SCOPE_KEY = 'ff_scope';
  var HISTORY_MAX = 2000, DAY_MS = 86400000, HISTORY_TTL_MS = 30 * DAY_MS, UTC7_MS = 7 * 3600000;
  var DAILY_GOAL = 10, RECENT_MAX = 5;

  // Mọi truy cập bộ nhớ bọc try/catch — chế độ riêng tư / bị chặn → null
  function storage(name) {
    try { var s = window[name]; s.getItem(HISTORY_KEY); return s; } catch (e) { return null; }
  }
  var local = storage('localStorage');
  var session = storage('sessionStorage');

  function readList(store, key) {
    if (!store) return null;
    try {
      var v = JSON.parse(store.getItem(key) || '[]');
      return $.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function writeList(store, key, list) {
    if (!store) return false;
    try { store.setItem(key, JSON.stringify(list)); return true; } catch (e) { return false; }
  }

  // ff_history = [{i: id, t: epoch ms, c: [slug hub], s: slug, n: tiêu đề, m: ảnh}] cũ → mới, bỏ mục quá 30 ngày mỗi lần đọc
  function readHistory() {
    var list = readList(local, HISTORY_KEY);
    if (list === null) return null;
    var cutoff = Date.now() - HISTORY_TTL_MS;
    return list.filter(function (h) { return h && typeof h.i === 'number' && typeof h.t === 'number' && h.t >= cutoff; });
  }

  // "Hôm nay" theo UTC+7 (A-009)
  function dayUtc7(t) { return Math.floor((t + UTC7_MS) / DAY_MS); }

  function ago(t) {
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' h ago';
    var d = Math.round(h / 24);
    return d === 1 ? '1 day ago' : d + ' days ago';
  }

  // Ảnh trong lịch sử chỉ nhận URL http(s) hoặc đường dẫn gốc của site
  function safeImg(src) { return /^(https?:)?\/\//i.test(src || '') || /^\/[^/]/.test(src || '') ? src : ''; }

  // Toast: một toast mỗi lúc, tự ẩn sau 2,5 s
  function showToast(msg) {
    $('.ff-toast').remove();
    var $t = $('<div class="ff-toast" role="status" aria-live="polite"></div>').text(msg).appendTo('body');
    setTimeout(function () { $t.remove(); }, 2500);
  }

  function idOf(el) { return parseInt($(el).closest('[data-ff-id]').attr('data-ff-id'), 10) || 0; }

  // Record the current fact in this browser's reading history.
  var $fact = $('[data-ff-fact]').first();
  var factId = $fact.length ? (parseInt($fact.attr('data-ff-id'), 10) || 0) : 0;
  var viewed = readHistory();

  if (factId) {
    var now = Date.now();
    if (viewed !== null) {
      viewed = viewed.filter(function (h) { return h.i !== factId; });
      viewed.push({
        i: factId, t: now,
        c: ($fact.attr('data-ff-cats') || '').split(',').filter(function (c) { return c; }),
        s: $fact.attr('data-ff-slug') || '', n: $fact.attr('data-ff-title') || '', m: $fact.attr('data-ff-thumb') || ''
      });
      if (viewed.length > HISTORY_MAX) viewed = viewed.slice(viewed.length - HISTORY_MAX);
      if (!writeList(local, HISTORY_KEY, viewed)) viewed = null;
    }
  }

  // Mục gần nhất trước, mỗi bài một lần; today = chỉ hôm nay
  function recent(max, today) {
    var out = [], ids = {}, d = dayUtc7(Date.now());
    for (var k = (viewed || []).length - 1; k >= 0 && out.length < max; k--) {
      var h = viewed[k];
      if (ids[h.i] || (today && dayUtc7(h.t) !== d)) continue;
      ids[h.i] = true;
      out.push(h);
    }
    return out;
  }

  function factImg(h, cls, w, hgt) {
    return $('<img alt="" loading="lazy" decoding="async">').attr({ src: safeImg(h.m), width: w, height: hgt }).addClass(cls || '');
  }

  // ── Đếm "hôm nay", thanh mục tiêu 10, danh sách gần đây, nhãn Read, "Your discoveries today" ──
  function renderHistory() {
    if (viewed === null) return;                      // bộ nhớ bị chặn → các bộ đếm giữ ẩn
    var today = recent(HISTORY_MAX, true);
    var n = today.length;
    $('[data-ff-count]').each(function () {
      $(this).find('[data-ff-count-n]').text(n);
      $(this).prop('hidden', false);
    });
    $('[data-ff-goal]').attr('aria-valuenow', Math.min(n, DAILY_GOAL))
      .find('.ff-streak__fill').css('width', Math.min(100, n / DAILY_GOAL * 100) + '%');

    var $recent = $('[data-ff-recent]').empty();
    $.each(recent(RECENT_MAX * 4, false).filter(function (h) { return h.s && h.n; }).slice(0, RECENT_MAX), function (_, h) {
      var $a = $('<a class="ff-mini"></a>').attr('href', pages.factUrl(h.s));
      $a.append(factImg(h, '', 56, 42));
      $('<span class="ff-mini__text"></span>')
        .append($('<span class="ff-mini__title"></span>').text(h.n))
        .append($('<span class="ff-mini__when"></span>').text(ago(h.t)))
        .appendTo($a);
      $('<li></li>').append($a).appendTo($recent);
    });

    var $disc = $('[data-ff-discoveries]');
    if ($disc.length) {
      var $grid = $disc.find('[data-ff-discoveries-grid]').empty();
      $.each(today.filter(function (h) { return h.s && h.n; }), function (_, h) {
        var $a = $('<a class="ff-card"></a>').attr('href', pages.factUrl(h.s));
        $('<span class="ff-card__media"></span>').append(factImg(h, '', 800, 450)).appendTo($a);
        $('<span class="ff-card__title"></span>').text(h.n).appendTo($a);
        $grid.append($a);
      });
      $disc.prop('hidden', !$grid.children().length);
    }
    markRead();
  }

  function markRead() {
    if (!viewed) return;
    var ids = {};
    viewed.forEach(function (h) { ids[h.i] = true; });
    $('[data-ff-card]').each(function () {
      $(this).find('.ff-card__read').prop('hidden', !ids[parseInt($(this).attr('data-ff-card'), 10)]);
    });
  }

  renderHistory();

  // ── Phạm vi (sessionStorage.ff_scope): chip đang chọn / thẻ nổi bật đặt; trang fact dùng phạm vi đã lưu ──
  // Dạng "all" | slug | "<kids>:<slug>" (trang For Kids lọc thêm chuyên mục)
  var scope = $('.ff-chip[aria-current]').attr('data-ff-scope') || $('[data-ff-feature][data-ff-scope]').attr('data-ff-scope') || '';
  function saveScope(v) {
    scope = v;
    try { if (session) session.setItem(SCOPE_KEY, v); } catch (e) { }
  }
  if (scope) {
    saveScope(scope);
  } else {
    try { scope = (session && session.getItem(SCOPE_KEY)) || 'all'; } catch (e) { scope = 'all'; }
  }

  function swapFeature($feature, scope, done) {
    if ($feature.attr('aria-busy') === 'true') return;
    $feature.attr('aria-busy', 'true');
    pages.load().then(function (data) {
      var fact = pages.pick(data, scope, $feature.attr('data-ff-id'));
      if (!fact) return;
      pages.fillFeature($feature[0], data, fact, scope);
      renderSaved();
      renderHistory();
      if (done) done($feature);
    }).catch(function () {
      showToast("Couldn't load the fact index. Try again.");
    }).finally(function () {
      $feature.removeAttr('aria-busy');
    });
  }

  // Pick an initial featured fact from this snapshot when the page opens.
  var $firstFeature = $('[data-ff-feature][data-ff-id]').first();
  if ($firstFeature.length) {
    swapFeature($firstFeature, scope);
  }

  $(document).on('click', '[data-ff-shuffle]', function (event) {
    var $feature = $(this).closest('[data-ff-feature]');
    if (!$feature.length) return;
    event.preventDefault();
    swapFeature($feature, 'all', function ($updated) {
      $updated.find('[data-ff-shuffle]').trigger('focus');
    });
  });

  $(document).on('click', '.ff-chip[data-ff-inplace]', function (event) {
    var $chip = $(this);
    var $feature = $('[data-ff-feature][data-ff-id]').first();
    if (!$feature.length) return;
    event.preventDefault();
    if ($chip.attr('aria-current')) return;
    var next = $chip.attr('data-ff-scope');
    swapFeature($feature, next, function () {
      $chip.closest('.ff-chips').find('.ff-chip').removeAttr('aria-current');
      $chip.attr('aria-current', 'true');
      saveScope(next);
    });
  });

  $(document).on('click', '[data-ff-next]', function (event) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    var $link = $(this);
    if ($link.attr('aria-busy') === 'true') return;
    $link.attr('aria-busy', 'true');
    var id = idOf(this);
    var seen = new Set((readHistory() || []).map(function (fact) { return fact.i; }));
    pages.load().then(function (data) {
      var fact = pages.pick(data, scope, id, seen);
      if (fact) window.location.href = pages.factUrl(fact.slug);
      else showToast('There are no other facts in this selection.');
    }).catch(function () {
      window.location.href = $link.attr('href');
    }).finally(function () {
      $link.removeAttr('aria-busy');
    });
  });

  // Save state is local to this browser.
  function setSaved($b, on) {
    $b.attr('aria-pressed', on ? 'true' : 'false');
    $b.find('i').first().attr('class', (on ? 'ph-fill' : 'ph-duotone') + ' ph-heart');
    $b.find('span').first().text(on ? 'Saved' : 'Save');
  }

  function renderSaved() {
    var list = readList(local, SAVED_KEY) || [];
    $('[data-ff-save]').each(function () { setSaved($(this), $.inArray(idOf(this), list) >= 0); });
  }

  function storeSaved(id, on) {
    var list = readList(local, SAVED_KEY);
    if (list === null) return false;
    list = list.filter(function (x) { return x !== id; });
    if (on) list.push(id);
    return writeList(local, SAVED_KEY, list);
  }

  renderSaved();

  $(document).on('click', '[data-ff-save]', function () {
    var $b = $(this);
    var id = idOf(this);
    if (!id) return;
    var on = $b.attr('aria-pressed') !== 'true';
    if (storeSaved(id, on)) setSaved($b, on);
    else showToast("This browser couldn't save the fact.");
  });

  // ── Share (FR-015): điện thoại có navigator.share → bảng chia sẻ; còn lại chép link, nhãn "Link copied!" 2 s; clipboard bị chặn → ô link ──
  $(document).on('click', '[data-ff-share]', function () {
    var $btn = $(this);
    var $item = $btn.closest('[data-ff-slug]');
    var url = $item.length
      ? window.location.origin + pages.factUrl($item.attr('data-ff-slug'))
      : window.location.href.split('#')[0];
    var title = $item.find('.ff-feature__title, .ff-article__title').first().text() || document.title;

    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && navigator.share) {
      navigator.share({ title: title, url: url }).catch(function () { });
      return;
    }
    function copied() {
      var $label = $btn.find('span').first().text('Link copied!');
      clearTimeout($btn.data('ffTimer'));
      $btn.data('ffTimer', setTimeout(function () { $label.text('Share'); }, 2000));
    }
    function showUrlBox() {
      var $box = $btn.parent().find('.ff-share-url');
      if (!$box.length) $box = $('<input type="text" class="ff-share-url" readonly aria-label="Link to share">').appendTo($btn.parent());
      $box.val(url).trigger('focus').trigger('select');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(copied, showUrlBox);
    } else {
      showUrlBox();
    }
  });

  // ── Add unseen cards from the snapshot and reshuffle the displayed cards. ──
  function renumber($grid) {
    $grid.children('.ff-card').each(function (i) { $(this).find('.ff-card__num').text('#' + (i + 1)); });
  }

  $('[data-ff-reshuffle]').prop('hidden', false);
  $(document).on('click', '[data-ff-reshuffle]', function () {
    var $grid = $(this).closest('.ff-popular').find('.ff-grid');
    var cards = $grid.children('.ff-card').get();
    for (var i = cards.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = cards[i]; cards[i] = cards[j]; cards[j] = t;
    }
    $grid.append(cards);
    renumber($grid);
  });

  $(document).on('click', '.ff-popular__more', function () {
    var $btn = $(this);
    var $box = $btn.closest('.ff-popular');
    var $grid = $box.find('.ff-grid');
    var $status = $box.find('.ff-popular__status');
    if ($btn.attr('aria-busy') === 'true') return;

    $btn.prop('disabled', true).attr('aria-busy', 'true');
    $status.text('');

    pages.load().then(function (data) {
      var shown = new Set($grid.children('[data-ff-card]').map(function () {
        return Number(this.dataset.ffCard);
      }).get());
      var remaining = data.facts.filter(function (fact) { return !shown.has(fact.id); });
      var count = Math.min(4, remaining.length);
      for (var i = 0; i < count; i++) {
        var index = Math.floor(Math.random() * remaining.length);
        $grid.append(pages.card(data, remaining.splice(index, 1)[0], true));
      }
      renumber($grid);
      markRead();
      $status.text(count ? count + ' more facts loaded' : 'All facts are shown.');
      if (!remaining.length) $btn.prop('hidden', true);
    }).catch(function () {
      $status.text("Couldn't load more facts. Try again.");
    }).finally(function () {
      $btn.prop('disabled', false).removeAttr('aria-busy');
    });
  });

  var $results = $('[data-ff-search-results]');
  if ($results.length) {
    var query = (new URLSearchParams(window.location.search).get('q') || '').trim();
    $('#globalSearch').val(query);
    if (query) {
      var $status = $('[data-ff-search-status]').text('Searching…');
      var $more = $('[data-ff-search-more]');
      pages.load().then(function (data) {
        var results = pages.search(data, query);
        var shown = 0;
        $status.text(results.length ? results.length + ' results for “' + query + '”' :
          'No facts found for “' + query + '”.');
        function showMore() {
          var batch = results.slice(shown, shown + 24);
          $results.append(batch.map(function (fact) { return pages.card(data, fact); }));
          shown += batch.length;
          $more.prop('hidden', shown >= results.length);
          markRead();
        }
        $more.on('click', showMore);
        showMore();
      }).catch(function () {
        $status.text("Couldn't load the fact index. Refresh the page to try again.");
      });
    }
  }

  // ── LQIP: Low Quality Image Placeholder + IntersectionObserver ───────────
  // Anh trong noi dung bai dung src=SVG placeholder + data-src=URL that
  // IntersectionObserver swap khi gan viewport -> blur reveal khi load xong

  function revealImg(img, wrap) {
    img.classList.remove('img-lazy');
    img.classList.add('img-loaded');
    if (wrap) wrap.classList.remove('is-loading');
  }

  // Observer: khi img cach viewport 200px -> bat dau load
  var lazyObserver = null;
  if ('IntersectionObserver' in window) {
    lazyObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var img = entry.target;
        var realSrc = img.getAttribute('data-src');
        if (realSrc) {
          var wrap = img.closest('.pfp-img-wrap, .img-container');
          if (wrap) wrap.classList.add('is-loading');
          img.addEventListener('load', function () { revealImg(img, wrap); }, { once: true });
          img.addEventListener('error', function () {
            img.classList.remove('img-lazy');
            if (wrap) wrap.classList.remove('is-loading');
          }, { once: true });
          img.src = realSrc;
          img.removeAttribute('data-src');
        }
        lazyObserver.unobserve(img);
      });
    }, { rootMargin: '200px 0px' }); // Pre-load 200px truoc khi vao viewport
  }

  function initLazyBlur() {
    document.querySelectorAll('img.img-lazy').forEach(function (img) {
      var dataSrc = img.getAttribute('data-src');

      if (dataSrc && lazyObserver) {
        // LQIP: co data-src -> observe de lazy load
        lazyObserver.observe(img);
      } else if (dataSrc && !lazyObserver) {
        // Fallback: khong co IntersectionObserver -> load ngay
        var wrap = img.closest('.pfp-img-wrap, .img-container');
        if (wrap) wrap.classList.add('is-loading');
        img.addEventListener('load', function () { revealImg(img, wrap); }, { once: true });
        img.addEventListener('error', function () {
          img.classList.remove('img-lazy');
          if (wrap) wrap.classList.remove('is-loading');
        }, { once: true });
        img.src = dataSrc;
        img.removeAttribute('data-src');
      } else {
        // Khong co data-src -> blur reveal binh thuong
        var wrap = img.closest('.pfp-img-wrap, .img-container');
        if (wrap) wrap.classList.add('is-loading');
        if (img.complete && img.naturalWidth > 0) {
          revealImg(img, wrap);
        } else {
          img.addEventListener('load',  function () { revealImg(img, wrap); }, { once: true });
          img.addEventListener('error', function () {
            img.classList.remove('img-lazy');
            if (wrap) wrap.classList.remove('is-loading');
          }, { once: true });
        }
      }
    });
  }
  window.initLazyBlur = initLazyBlur;
  initLazyBlur();

});
