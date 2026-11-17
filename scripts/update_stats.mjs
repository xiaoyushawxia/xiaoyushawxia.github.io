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

async function run() {
    const cityIndex = loadCities(GEONAMES);

    const countries = (await report(["countryId", "country"]))
        .map(({ dims: [code, name], value }) => ({ name, code, value }))
        .filter(c => c.name && c.name !== "(not set)" && c.value > 0)
        .sort((a, b) => b.value - a.value);

    let matched = 0;
    const cities = (await report(["countryId", "country", "city"]))
        .filter(({ dims: [, country], value }) => country && country !== "(not set)" && value > 0)
        .map(({ dims: [code, country, city], value }) => {
            const known = city && city !== "(not set)";
            const place = known && cityIndex[code] && cityIndex[code][city.toLowerCase()];
            if (place) matched++;
            return place
                ? { name: city, country, code, value, lat: round(place.lat), lon: round(place.lon) }
                : { name: known ? city : null, country, code, value };   // drawn at the country centre
        })
        .sort((a, b) => b.value - a.value);

    const visits = countries.reduce((sum, c) => sum + c.value, 0);
    console.log(`${visits} visits, ${countries.length} countries, ${matched}/${cities.length} cities located`);

    fs.writeFileSync("../stats.json", JSON.stringify({ metric: "sessions", visits, countries, cities }, null, 2));
}

run();
