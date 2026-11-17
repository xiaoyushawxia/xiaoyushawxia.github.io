/*
 * visitor-map.js — renders the "Visitors" bubble map (one bubble per city)
 * and the country ranking (visits per country), and keeps
 * the block in the sidebar on wide screens and in the main column on narrow ones.
 *
 * Data sources (both static files in this repo, no third-party requests):
 *   stats.json                  — refreshed daily from Google Analytics by
 *                                 .github/workflows/update_stats.yml
 *   assets/data/world-map.json  — pre-projected world geometry, one x/y
 *                                 point per country, and the projection's
 *                                 scale/offset so city coordinates can be
 *                                 placed on the same map.
 *
 * Counts are visits (GA sessions), not distinct people.
 */
(function () {
  'use strict';

  var root = document.getElementById('visitorMap');
  if (!root || !window.fetch) {
    return;
  }

  var MIN_R = 3.5;
  /* ISO codes drawn as a single country-level bubble on the map (mainland China). */
  var WHOLE_COUNTRIES = ['CN'];

  var MAX_R = 18;   /* one bubble per city, so a little smaller than per country */

  /* --- where the block lives --------------------------------------------
   * Wide screens: in the profile sidebar, under the social links. Below
   * 900px the sidebar stacks above the content, so the block moves to the
   * end of the main column (before the footer) instead of pushing the bio
   * down the page.
   */
  var sidebar = document.querySelector('.profile');
  var main = document.getElementById('main');
  var narrow = window.matchMedia ? window.matchMedia('(max-width: 900px)') : null;

  function place() {
    if (!sidebar || !main) return;
    if (narrow && narrow.matches) {
      if (root.parentNode !== main) main.insertBefore(root, main.querySelector('.site-footer'));
    } else if (root.parentNode !== sidebar) {
      sidebar.appendChild(root);
    }
    fit();
  }

  /*
   * The sidebar is sticky. With the map in it, it can be taller than the
   * window, and a plain sticky top would then hide its lower half. Lowering
   * `top` (negative if need be) lets it scroll until its bottom is in view
   * and stick from there.
   */
  function fit() {
    if (!sidebar) return;
    sidebar.style.top = '';
    if (narrow && narrow.matches) return;
    var top = parseFloat(window.getComputedStyle(sidebar).top) || 0;
    var room = window.innerHeight - sidebar.offsetHeight - 24;
    if (room < top) sidebar.style.top = room + 'px';
  }

  place();
  if (narrow) {
    if (narrow.addEventListener) narrow.addEventListener('change', place);
    else if (narrow.addListener) narrow.addListener(place);
  }
  window.addEventListener('resize', fit);

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function radius(value, max) {
    if (max <= 0) return MIN_R;
    return MIN_R + (MAX_R - MIN_R) * Math.sqrt(value / max);
  }

  /*
   * Country names are matched against the pre-projected lookup table. The table
   * already carries the official name and the common alternative spellings for
   * every country; this last-resort pass folds away punctuation, accents and
   * "and"/"&" differences so a stray spelling still finds its point.
   */
  function locator(points) {
    var loose = {};
    var simplify = function (name) {
      return String(name)
        .toLowerCase()
        .normalize ? String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/ ?& ?/g, ' and ').replace(/[^a-z0-9]+/g, '')
          : String(name).toLowerCase().replace(/[^a-z0-9]+/g, '');
    };

    Object.keys(points).forEach(function (name) {
      var key = simplify(name);
      if (!loose[key]) loose[key] = points[name];
    });

    return function (name) {
      return points[name] || loose[simplify(name)] || null;
    };
  }

  function getJSON(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error(url + ' -> ' + response.status);
      return response.json();
    });
  }

  /*
   * Natural Earth projection, as d3-geo draws it, with the scale and offset
   * saved in world-map.json — so a city's latitude/longitude lands on the
   * same map as the pre-drawn coastlines.
   */
  function projector(world) {
    var pr = world.projection;
    if (!pr || pr.type !== 'naturalEarth1') return null;
    var k = pr.scale, tx = pr.translate[0], ty = pr.translate[1];
    return function (lon, lat) {
      var l = lon * Math.PI / 180, f = lat * Math.PI / 180;
      var f2 = f * f, f4 = f2 * f2;
      var x = l * (0.8707 - 0.131979 * f2 + f4 * (-0.013791 + f4 * (0.003971 * f2 - 0.001529 * f4)));
      var y = f * (1.007226 + f2 * (0.015085 + f4 * (-0.044475 + 0.028874 * f2 - 0.005916 * f4)));
      return [tx + k * x, ty - k * y];
    };
  }

  function renderMap(world, bubbles, max) {
    /* Largest bubbles first so the small ones stay hoverable on top. */
    var drawn = bubbles.slice().sort(function (a, b) { return b.value - a.value; });

    var circles = drawn.map(function (c) {
      var label = c.label + ': ' + c.value.toLocaleString() + (c.value === 1 ? ' visit' : ' visits');
      return '<circle class="visitor-map__bubble" data-country="' + escapeHtml(c.country) + '"' +
        ' cx="' + c.x.toFixed(1) + '" cy="' + c.y.toFixed(1) + '" r="' + radius(c.value, max).toFixed(1) + '"' +
        ' tabindex="0" role="img" aria-label="' + escapeHtml(label) + '">' +
        '<title>' + escapeHtml(label) + '</title></circle>';
    }).join('');

    var viewBox = world.viewBox || ('0 0 ' + world.width + ' ' + world.height);

    return '<svg class="visitor-map__svg" viewBox="' + viewBox + '"' +
      ' role="img" aria-label="World map of visitor locations" preserveAspectRatio="xMidYMid meet">' +
      '<path class="visitor-map__land" d="' + world.land + '"/>' +
      '<path class="visitor-map__borders" d="' + world.borders + '"/>' +
      circles +
      '</svg>';
  }

  /*
   * One bubble per city (visits at the same spot are merged). Without city
   * data — an older stats.json — fall back to one bubble per country.
   */
  function bubblesFor(stats, countries, world, pointOf) {
    var project = projector(world);
    if (!project || !Array.isArray(stats.cities) || !stats.cities.length) {
      return countries.filter(function (c) { return c.point; }).map(function (c) {
        return { x: c.point[0], y: c.point[1], value: c.value, label: c.name, country: c.name };
      });
    }

    var spots = {};
    stats.cities.forEach(function (c) {
      if (!c || !(c.value > 0)) return;
      /* Countries shown as one bubble rather than city by city. */
      var whole = WHOLE_COUNTRIES.indexOf(String(c.code || '').toUpperCase()) !== -1;
      var xy = (!whole && typeof c.lat === 'number' && typeof c.lon === 'number')
        ? project(c.lon, c.lat)
        : (pointOf(c.country, c.code) || null);
      if (!xy) return;
      var key = Math.round(xy[0]) + ',' + Math.round(xy[1]);
      var spot = spots[key] || (spots[key] = { x: xy[0], y: xy[1], value: 0, names: [], country: c.country });
      spot.value += c.value;
      if (!whole && c.name && spot.names.indexOf(c.name) === -1) spot.names.push(c.name);
    });

    return Object.keys(spots).map(function (key) {
      var s = spots[key];
      var place = s.names.length ? s.names.slice(0, 3).join(', ') + (s.names.length > 3 ? ' and others' : '') + ', ' : '';
      return { x: s.x, y: s.y, value: s.value, label: place + s.country, country: s.country };
    });
  }

  function renderRanking(countries, max) {
    return countries.slice(0, 10).map(function (c) {
      var share = max > 0 ? Math.max(2, Math.round((c.value / max) * 100)) : 0;
      var code = c.point ? c.point[2] : null;
      var flag = code
        ? '<img class="visitor-map__flag" src="./assets/flags/' + code + '.png"' +
          ' alt="" width="20" height="15" loading="lazy" decoding="async">'
        : '<span class="visitor-map__flag visitor-map__flag--blank" aria-hidden="true"></span>';

      return '<li class="visitor-map__row" data-country="' + escapeHtml(c.name) + '">' +
        flag +
        '<span class="visitor-map__country" title="' + escapeHtml(c.name) + '">' +
        escapeHtml(c.name) + '</span>' +
        '<span class="visitor-map__value">' + c.value.toLocaleString() + '</span>' +
        '<span class="visitor-map__bar" aria-hidden="true">' +
        '<span class="visitor-map__bar-fill" style="width:' + share + '%"></span></span>' +
        '</li>';
    }).join('');
  }

  function link(root) {
    /* Hovering a ranking row highlights the matching bubble, and vice versa. */
    function highlight(name, on) {
      var selector = '[data-country="' + (window.CSS && CSS.escape ? CSS.escape(name) : name) + '"]';
      Array.prototype.forEach.call(root.querySelectorAll(selector), function (el) {
        el.classList.toggle('is-active', on);
      });
    }

    Array.prototype.forEach.call(root.querySelectorAll('[data-country]'), function (el) {
      var name = el.getAttribute('data-country');
      ['mouseenter', 'focus'].forEach(function (evt) {
        el.addEventListener(evt, function () { highlight(name, true); });
      });
      ['mouseleave', 'blur'].forEach(function (evt) {
        el.addEventListener(evt, function () { highlight(name, false); });
      });
    });
  }

  Promise.all([
    getJSON('./stats.json'),
    getJSON('./assets/data/world-map.json')
  ]).then(function (results) {
    var stats = results[0];
    var world = results[1];

    var locate = locator(world.points);
    var byCode = {};
    Object.keys(world.points).forEach(function (name) {
      var p = world.points[name];
      if (p[2] && !byCode[p[2]]) byCode[p[2]] = p;
    });
    function pointOf(name, code) {
      return (code && byCode[String(code).toLowerCase()]) || locate(name);
    }

    /* Ranking: visits per country. */
    var countries = (stats.countries || [])
      .filter(function (c) { return c && c.name && c.name !== '(not set)' && c.value > 0; })
      .map(function (c) { return { name: c.name, value: c.value, point: pointOf(c.name, c.code) }; })
      .sort(function (a, b) { return b.value - a.value; });

    var max = countries.length ? countries[0].value : 0;

    /* Map: visits per city. */
    var bubbles = bubblesFor(stats, countries, world, pointOf);
    var bubbleMax = bubbles.reduce(function (m, c) { return Math.max(m, c.value); }, 0);

    root.querySelector('[data-visitor-canvas]').innerHTML = renderMap(world, bubbles, bubbleMax);
    root.querySelector('[data-visitor-ranking]').innerHTML = renderRanking(countries, max);

    link(root);
    root.hidden = false;
    fit();
  }).catch(function (error) {
    console.error('Visitor map unavailable:', error);

    /*
     * Browsers refuse fetch() on file:// URLs, so opening index.html straight
     * from disk can never load stats.json. That is a local-preview problem,
     * not a broken page — say so here rather than leaving a silent gap, but
     * only ever on file://; served pages just stay hidden.
     */
    if (window.location.protocol === 'file:') {
      root.querySelector('[data-visitor-canvas]').innerHTML =
        '<p class="visitor-map__note">The visitor map reads stats.json over HTTP, which a ' +
        'page opened directly from disk cannot do. Serve the folder instead &mdash; for ' +
        'example <code>python3 -m http.server</code>, then open ' +
        '<code>http://localhost:8000/</code>.</p>';
      root.hidden = false;
      fit();
    }
  });
})();
