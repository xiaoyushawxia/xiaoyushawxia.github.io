/*
 * update_stats.mjs — refreshes stats.json for the "Visitors" map on the homepage.
 *
 * Counts are visits (Google Analytics "sessions") over the past 365 days:
 * someone who comes back next week counts twice. GA identifies visitors by a
 * browser cookie, not by IP address.
 *
 *   countries  visits per country — the ranking on the page
 *   cities     visits per city with coordinates — the bubbles on the map
 *
 * City coordinates come from GeoNames (cities1000.txt, CC BY 4.0), which the
 * workflow downloads next to this script. A city GeoNames does not know, or
 * one GA reports as "(not set)", is placed at its country's centre instead.
 *
 * Mainland China: GA's tag rarely loads there, so when Baidu Tongji is set
 * up (BAIDU_* secrets, see README) China's figure comes from Baidu instead
 * — visits summed over mainland provinces for the same 365 days. The larger
 * of the two figures is used, so the number never drops while Baidu's own
 * history is still short. Without the secrets this step is skipped.
 */
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import fs from "fs";

const client = new BetaAnalyticsDataClient({
    credentials: JSON.parse(process.env.GA_CREDENTIALS)
});

const property = `properties/${process.env.GA_PROPERTY_ID}`;
const dateRanges = [{ startDate: "365daysAgo", endDate: "today" }];
const GEONAMES = process.env.GEONAMES_FILE || "cities1000.txt";

/* ------------------------------------------------------------ GeoNames */

/* index[ISO2][lower-case name] = { lat, lon, pop } — the most populous place wins. */
function loadCities(file) {
    const index = {};
    if (!fs.existsSync(file)) {
        console.warn(`${file} not found; cities will sit at their country's centre.`);
        return index;
    }
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const f = line.split("\t");
        if (f.length < 15) continue;
        const [, name, ascii, alternates, lat, lon] = f;
        const cc = f[8], pop = Number(f[14]) || 0;
        const byName = index[cc] || (index[cc] = {});
        const place = { lat: Number(lat), lon: Number(lon), pop };
        for (const n of [name, ascii, ...alternates.split(",")]) {
            const key = n.trim().toLowerCase();
            if (key && (!byName[key] || byName[key].pop < pop)) byName[key] = place;
        }
    }
    return index;
}

const round = n => Math.round(n * 100) / 100;

/* ------------------------------------------------------------- reports */

async function report(dimensions) {
    const [res] = await client.runReport({
        property,
        dateRanges,
        dimensions: dimensions.map(name => ({ name })),
        metrics: [{ name: "sessions" }],
        limit: 5000
    });
    return (res.rows || []).map(r => ({
        dims: r.dimensionValues.map(d => d.value),
        value: Number(r.metricValues[0].value)
    }));
}

/* ---------------------------------------------------------- Baidu Tongji */

const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, "");

async function baiduChinaVisits() {
    const { BAIDU_API_KEY: key, BAIDU_SECRET_KEY: secret,
            BAIDU_REFRESH_TOKEN: refresh, BAIDU_SITE_ID: site } = process.env;
    if (!key || !secret || !refresh || !site) return null;

    /* Baidu hands out a new refresh token every time one is used; the workflow
       stores it back into the repository secret right after this script. */
    const tokenUrl = "https://openapi.baidu.com/oauth/2.0/token?grant_type=refresh_token" +
        `&refresh_token=${encodeURIComponent(refresh)}&client_id=${encodeURIComponent(key)}` +
        `&client_secret=${encodeURIComponent(secret)}`;
    const token = await (await fetch(tokenUrl)).json();
    if (!token.access_token) throw new Error("Baidu token refresh failed: " + JSON.stringify(token));
    if (token.refresh_token) fs.writeFileSync("baidu_refresh_token.txt", token.refresh_token);

    const end = new Date(), start = new Date(Date.now() - 365 * 864e5);
    const url = "https://openapi.baidu.com/rest/2.0/tongji/report/getData" +
        `?access_token=${encodeURIComponent(token.access_token)}&site_id=${encodeURIComponent(site)}` +
        `&method=visit/district/a&start_date=${ymd(start)}&end_date=${ymd(end)}` +
        "&metrics=visit_count&max_results=0";
    const data = await (await fetch(url)).json();
    const result = data.result;
    if (!result || !Array.isArray(result.items)) throw new Error("Baidu report failed: " + JSON.stringify(data));

    /* items[0] = one [ {name, ...} ] per province, items[1] = one [visit_count] per province. */
    const names = result.items[0] || [], values = result.items[1] || [];
    let visits = 0;
    names.forEach((dim, i) => {
        const name = String((dim && dim[0] && dim[0].name) || "");
        if (/香港|台湾|澳门|Hong Kong|Taiwan|Macau|Macao/i.test(name)) return;   // listed separately
        visits += Number((values[i] || [])[0]) || 0;
    });
    return visits;
}

async function run() {
    const cityIndex = loadCities(GEONAMES);

    const countries = (await report(["countryId", "country"]))
        .map(({ dims: [code, name], value }) => ({ name, code, value }))
        .filter(c => c.name && c.name !== "(not set)" && c.value > 0)
        .sort((a, b) => b.value - a.value);

    const cities = (await report(["countryId", "country", "city"]))
        .filter(({ dims: [, country], value }) => country && country !== "(not set)" && value > 0)
        .map(({ dims: [code, country, city], value }) => {
            const known = city && city !== "(not set)";
            const place = known && cityIndex[code] && cityIndex[code][city.toLowerCase()];
            return place
                ? { name: city, country, code, value, lat: round(place.lat), lon: round(place.lon) }
                : { name: known ? city : null, country, code, value };   // drawn at the country centre
        })
        .sort((a, b) => b.value - a.value);

    let china = null;
    try {
        china = await baiduChinaVisits();
    } catch (err) {
        console.warn(String(err));          // keep GA's figure if Baidu is unavailable
    }
    if (china !== null) {
        const ga = countries.find(c => c.code === "CN");
        const value = Math.max(china, ga ? ga.value : 0);
        console.log(`China: Baidu ${china}, GA ${ga ? ga.value : 0} -> ${value}`);
        if (ga) ga.value = value;
        else if (value > 0) countries.push({ name: "China", code: "CN", value });
        countries.sort((a, b) => b.value - a.value);
        /* On the map China is one bubble, so its city rows collapse into one. */
        for (let i = cities.length - 1; i >= 0; i--) if (cities[i].code === "CN") cities.splice(i, 1);
        if (value > 0) cities.push({ name: null, country: "China", code: "CN", value });
        cities.sort((a, b) => b.value - a.value);
    }

    const visits = countries.reduce((sum, c) => sum + c.value, 0);
    const located = cities.filter(c => typeof c.lat === "number").length;
    console.log(`${visits} visits, ${countries.length} countries, ${located}/${cities.length} map spots with city coordinates`);

    fs.writeFileSync("../stats.json", JSON.stringify({ metric: "sessions", visits, countries, cities }, null, 2));
}

run();
