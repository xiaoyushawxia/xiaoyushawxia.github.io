/*
 * publications.js — two views of the publications page.
 *
 * The markup is grouped into topic sections; that grouping is the source of
 * truth and is what readers without JavaScript see. With the script, the
 * default view ("Listed publications") re-lists every paper under Conference
 * Papers and Journal Articles, newest first, with papers from the same venue
 * and year kept together. Choosing a topic button switches
 * back to the topic sections and shows only the ones it selects.
 *
 * Venue type is read from the periodical line: anything naming a Conference or
 * Symposium is a conference paper, everything else a journal article. Put
 * data-type="conf" or data-type="journal" on an <li> to override that. Counts
 * come from the markup too, so adding a paper needs no change here. The topic
 * choice is mirrored into the URL hash so a filtered view can be linked to,
 * and every paper has an id, so publications.html#<id> opens on that paper.
 */
(function () {
  'use strict';

  var bar = document.getElementById('pubFilter');
  var list = document.querySelector('.publications');
  if (!bar || !list) {
    return;
  }

  var sections = Array.prototype.slice.call(list.querySelectorAll('.pub-topic-section'));
  var pillars = Array.prototype.slice.call(list.querySelectorAll('.pub-pillar'));
  var buttons = Array.prototype.slice.call(bar.querySelectorAll('[data-topics]'));
  var status = bar.querySelector('.pub-filter__status');
  if (!sections.length) {
    return;
  }

  function codesOf(el) {
    return (el.getAttribute('data-topics') || '').split(/\s+/).filter(Boolean);
  }

  function papersIn(section) {
    return section.querySelectorAll('li[data-topics]').length;
  }

  var total = sections.reduce(function (sum, s) { return sum + papersIn(s); }, 0);

  /* --- the by-venue view, built from the topic sections ----------------- */
  function textOf(li, selector) {
    var el = li.querySelector(selector);
    return el ? el.textContent : '';
  }

  function yearOf(li) {
    var m = /(\d{4})\D*$/.exec(textOf(li, '.periodical'));
    if (m) return +m[1];
    m = /'(\d{2})\s*$/.exec(textOf(li, '.badge'));
    return m ? 2000 + +m[1] : 0;
  }

  function typeOf(li) {
    var given = li.getAttribute('data-type');
    if (given) return given;
    return /\b(conference|symposium)\b/i.test(textOf(li, '.periodical')) ? 'conf' : 'journal';
  }

  function venueOf(li) {
    return textOf(li, '.badge').replace(/\s*'\d{2}\s*$/, '').trim();
  }

  var papers = Array.prototype.slice.call(list.querySelectorAll('.pub-topic-section li[data-topics]'))
    .map(function (li, i) {
      return { li: li, year: yearOf(li), type: typeOf(li), venue: venueOf(li), order: i };
    });

  /* Within a year, papers at the same venue sit together; venues keep the
     order in which they first appear on the page. */
  var firstSeen = {};
  papers.forEach(function (p) {
    var key = p.year + '|' + p.venue;
    if (!(key in firstSeen)) firstSeen[key] = p.order;
  });
  papers.sort(function (a, b) {
    return (b.year - a.year) ||
      (firstSeen[a.year + '|' + a.venue] - firstSeen[b.year + '|' + b.venue]) ||
      (a.order - b.order);
  });

  var byVenue = document.createElement('div');
  byVenue.className = 'pub-venue-view';
  [['conf', 'Conference Papers', 'conference-papers'],
   ['journal', 'Journal Articles', 'journal-articles']].forEach(function (group) {
    var mine = papers.filter(function (p) { return p.type === group[0]; });
    if (!mine.length) return;
    var section = document.createElement('section');
    section.className = 'pub-venue';
    section.setAttribute('data-venue', group[0]);
    var heading = document.createElement('h3');
    heading.className = 'pillar-title';
    heading.id = group[2];
    heading.textContent = group[1];
    var ol = document.createElement('ol');
    ol.className = 'bibliography';
    mine.forEach(function (p) {
      /* The copy carries the paper's id as data-paper so ids stay unique. */
      var copy = p.li.cloneNode(true);
      if (p.li.id) {
        copy.removeAttribute('id');
        copy.setAttribute('data-paper', p.li.id);
      }
      ol.appendChild(copy);
    });
    section.appendChild(heading);
    section.appendChild(ol);
    byVenue.appendChild(section);
  });
  list.appendChild(byVenue);

  /* --- counts, straight from the markup --------------------------------- */
  buttons.forEach(function (button) {
    var slot = button.querySelector('.pub-filter__count');
    if (!slot) return;
    var wanted = codesOf(button);
    slot.textContent = wanted.length
      ? sections.reduce(function (sum, s) {
          return wanted.indexOf(s.getAttribute('data-topic')) === -1 ? sum : sum + papersIn(s);
        }, 0)
      : total;
  });

  /* --- applying a filter ------------------------------------------------ */
  function apply(button, keepHash) {
    var wanted = codesOf(button);
    var shown = 0;

    /* No topic chosen: show the by-venue list and hide the topic sections. */
    byVenue.hidden = wanted.length > 0;

    sections.forEach(function (section) {
      var match = wanted.indexOf(section.getAttribute('data-topic')) !== -1;
      section.hidden = !match;
      if (match) shown += papersIn(section);
    });

    /* A pillar with both of its topics hidden should take its heading with it. */
    pillars.forEach(function (pillar) {
      pillar.hidden = !pillar.querySelector('.pub-topic-section:not([hidden])');
    });

    buttons.forEach(function (other) {
      other.classList.toggle('is-active', other === button);
      other.setAttribute('aria-pressed', String(other === button));
    });

    if (status) {
      status.textContent = wanted.length
        ? 'Showing ' + shown + ' of ' + total + ' publications'
        : '';
    }

    var hash = wanted.length ? '#topic=' + wanted.join('+') : '';
    if (!keepHash && window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search + hash);
    }
  }

  buttons.forEach(function (button) {
    button.addEventListener('click', function () { apply(button); });
  });

  /* --- links to a single paper (publications.html#trace-neurips26) ------ */
  function showPaper(id) {
    var original = id && document.getElementById(id);
    if (!original || !original.matches('li[data-topics]')) return false;

    /* Show it where it currently lives: the by-venue copy in the default
       view, or the topic section when a topic is selected. */
    var target = byVenue.hidden ? original : byVenue.querySelector('[data-paper="' + id + '"]');
    if (!target || target.closest('[hidden]')) {
      apply(buttons[0], true);
      target = byVenue.querySelector('[data-paper="' + id + '"]');
    }
    if (!target) return false;

    target.scrollIntoView({ block: 'start' });
    var row = target.querySelector('.pub-row');
    if (row) {
      row.classList.remove('is-target');
      void row.offsetWidth;            /* restart the highlight if clicked again */
      row.classList.add('is-target');
    }
    return true;
  }

  window.addEventListener('hashchange', function () {
    var id = window.location.hash.slice(1);
    if (id && id.indexOf('topic=') !== 0) showPaper(decodeURIComponent(id));
  });

  /* --- restore a linked-to filter or paper ------------------------------ */
  var fromHash = /^#topic=(.+)$/.exec(window.location.hash);
  var initial = buttons[0];
  if (fromHash) {
    var key = decodeURIComponent(fromHash[1]).split('+').join(' ');
    buttons.forEach(function (button) {
      if (button.getAttribute('data-topics') === key) initial = button;
    });
  }

  bar.hidden = false;      /* the controls do nothing without this script */
  var paperId = !fromHash && window.location.hash.length > 1
    ? decodeURIComponent(window.location.hash.slice(1)) : '';
  apply(initial, Boolean(paperId));
  if (paperId) {
    window.requestAnimationFrame(function () { showPaper(paperId); });
  }
})();
