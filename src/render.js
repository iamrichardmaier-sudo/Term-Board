/**
 * Rebuild the Term Board artifact from a scrape snapshot.
 *
 * The board is an Artifact, and artifacts cannot fetch anything at runtime —
 * the sandbox blocks every outbound request — so it cannot poll for its own
 * data. It has to be regenerated and republished. This module produces exactly
 * the HTML to republish; a scheduled Claude routine does the publishing.
 *
 * The original board's CSS is reused untouched (src/template/styles.css), so
 * week grouping, the class colour bands and the drill toggle all behave as they
 * did before any of this existed.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TERM } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const escape = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

/** Meeting times aren't in Learning Suite's gradebook, so they stay configured. */
const MEETING = {
  "ARAB 201": "MWF 9:00&ndash;9:50 AM &middot; 270 MCKB<br>+ TTh 1:00&ndash;1:50 PM (2nd section)",
  "IHUM 242": "TTh 9:30&ndash;10:45 AM &middot; 3710 HBLL",
  "ECON 378": "MW 2:00&ndash;3:15 PM",
  "ECON 380": "MWF 11:00&ndash;11:50 AM",
  "ECON 381": "TTh 3:30&ndash;4:45 PM",
  "ECON 210": "W 4:00&ndash;4:50 PM",
  "GCI 330": "TTh 2:00&ndash;3:15 PM",
  "GCI 320": "Meeting time not listed &mdash; likely async/online",
};

const PEOPLE = {
  "ARAB 201": "Kirk Belnap &middot; Spencer Scoville<br>TA: Fida Zamamiri",
  "IHUM 242": "Kevin Blankinship &middot; Robert Colson<br>TA: Luke Balicao",
};

const EXTRA_LINKS = {
  "ARAB 201": [{ label: "Lingco", href: "https://class.lingco.io/courses/159504" }],
};

/**
 * Registration facts Learning Suite will not tell us. A waitlisted course looks
 * exactly like an enrolled one from the outside, and the board has always said
 * so explicitly — dropping that would quietly turn a maybe into a yes.
 */
const WAITLISTED = new Set(["ECON 380", "ECON 381"]);

/**
 * Dated banners. `until` is what stops a note about a 14-day trial from still
 * being on the board in December; a notice with no end date never expires.
 */
const NOTICES = [
  {
    text: "&#9200; Lingco (Al-Kitaab Vol. 2) trial started Aug 29 &mdash; 14 days free, then $105&ndash;140 to keep access.",
    until: "2026-09-30",
  },
];

function noticesSection() {
  const today = new Date().toISOString().slice(0, 10);
  return NOTICES.filter((n) => !n.until || n.until >= today)
    .map((n) => `  <div class="trial-note">${n.text}</div>`)
    .join("\n");
}

function courseCard(course) {
  const cls = `course-card ${course.group}${course.published ? "" : " tbd"}`;
  const badgeClass = course.grade?.percent != null ? "grade-badge has-grade" : "grade-badge pending";

  const links = [];
  if (course.cid) {
    links.push({
      label: "Gradebook",
      href: `https://learningsuite.byu.edu/.NYCE/${course.cid}/student/gradebook`,
    });
  }
  links.push(...(EXTRA_LINKS[course.code] || []));

  return `    <div class="${cls}">
      <h2>${escape(course.code)}${course.name && course.name !== course.code ? ` &middot; ${escape(course.name)}` : ""}</h2>
      <div class="meet">${MEETING[course.code] || "Meeting time not listed"}</div>
      <div class="${badgeClass}">${escape(course.gradeLabel)}</div>
      <div class="people">${
        PEOPLE[course.code] ||
        (WAITLISTED.has(course.code)
          ? `Assuming you clear the waitlist<span class="tag-waitlist">waitlist</span>`
          : course.published
            ? "Published on Learning Suite"
            : "Registered")
      }</div>
      ${links.length ? `<div class="links">${links
        .map((l) => `<a href="${escape(l.href)}" target="_blank" rel="noopener">${escape(l.label)}</a>`)
        .join("")}</div>` : ""}
    </div>`;
}

function flagsSection(flags, seeded) {
  // A seeded board has not extracted anything yet, so it must not claim that
  // everything extracted cleanly. Silence here would read as a clean bill of
  // health, which is the one thing it is not.
  if (seeded) {
    return `  <div class="flags">
    <h3>Reading extraction hasn't run yet</h3>
    <div class="sub">These assignments came from the manual August pull. The scraper hasn't read their instructions or attachments yet, so nothing is marked conversation-ready and nothing is flagged. Both appear after the first morning run.</div>
  </div>`;
  }
  if (!flags.length) {
    return `  <div class="flags">
    <h3>Reading extraction</h3>
    <div class="sub">Every assignment with reading material came through as clean text. All of them will work in a voice walkthrough.</div>
  </div>`;
  }
  return `  <div class="flags">
    <h3>Won't work well in a voice walkthrough</h3>
    <div class="sub">${flags.length} assignment${flags.length === 1 ? "" : "s"} whose reading didn't come through as clean text &mdash; scanned or image-only PDFs, mostly. You can still do them; they just can't be read aloud without OCR.</div>
    <ul>
${flags
  .map(
    (f) => `      <li>
        <span class="fl-course ${escape(groupOf(f.course))}">${escape(shortCode(f.course))}</span>
        <span>${escape(f.title)}</span>
        <span class="flag-chip ${escape(f.quality)}">${escape(f.quality)}</span>
        <span class="fl-why">${escape(f.reason || "")}</span>
      </li>`,
  )
  .join("\n")}
    </ul>
  </div>`;
}

function groupOf(code) {
  const prefix = String(code).split(/\s+/)[0].toLowerCase();
  return ["arab", "ihum", "econ", "gci"].includes(prefix) ? prefix : "econ";
}
function shortCode(code) {
  return String(code).split(/\s+/)[0];
}

export async function renderBoard(snapshot) {
  const css = await fs.readFile(path.join(here, "template", "styles.css"), "utf8");

  const items = snapshot.assignments.map((a) => [
    a.course,
    a.title,
    a.due,
    a.category,
    a.minor ? 1 : 0,
    a.graded && a.score != null ? a.score : null,
    a.possible ?? null,
    a.conversationReady ? 0 : a.textQuality === "clean" || a.textQuality === "unknown" ? 0 : 1,
  ]);

  const published = snapshot.courses.filter((c) => c.published).length;
  const credits = snapshot.courses.length;

  return `<title>Term Board</title>
<style>
${css}</style>

<div class="wrap">
  <header class="top">
    <div>
      <h1>Term Board</h1>
      <div class="term">${escape(snapshot.term.label)} &middot; ${credits} courses &middot; ${published} live on Learning Suite</div>
    </div>
    <div class="today-chip" id="todayChip"></div>
  </header>

  <div class="freshness" id="freshness"></div>

  <div class="courses">
${snapshot.courses.map(courseCard).join("\n")}
  </div>

${noticesSection()}

  <div class="forward">
    <h3>Looking forward</h3>
    <ul id="forwardList"></ul>
  </div>

${flagsSection(snapshot.flags, snapshot.seeded)}

  <div class="controls">
    <div class="legend">
      <span><span class="dot overdue"></span>overdue</span>
      <span><span class="dot soon"></span>due &le; 3 days</span>
      <span><span class="dot later"></span>later</span>
    </div>
    <button class="toggle-btn" id="drillToggle">Show daily drills &amp; verb charts</button>
  </div>

  <div id="weeks"></div>

  <footer class="note">
    ${snapshot.seeded
      ? `Seeded from the manual Learning Suite pull of 28&ndash;29 August, in the schema the scraper writes. Grades and reading flags fill in from the first automatic run.`
      : `Scraped from BYU Learning Suite automatically each morning &mdash; assignments, due dates and gradebook scores for every published course.`} Courses whose instructors haven't published a syllabus yet show meeting times only. Full semester, including drills, also lives on your Google Calendar; this board is the curated view.
  </footer>
</div>

<script>
(function(){
  var SCRAPED_AT = ${JSON.stringify(snapshot.scrapedAt)};
  var items = ${JSON.stringify(items)}.map(function(r){
    return {
      course:r[0], title:r[1], due:r[2] ? new Date(r[2]) : null, cat:r[3],
      minor: !!r[4], score:r[5], possible:r[6], flagged: !!r[7]
    };
  });

  function group(code){
    var p = String(code).split(/\\s+/)[0].toLowerCase();
    return ['arab','ihum','econ','gci'].indexOf(p) >= 0 ? p : 'econ';
  }
  function shortCode(code){ return String(code).split(/\\s+/)[0]; }

  var now = new Date();
  document.getElementById('todayChip').textContent =
    now.toLocaleDateString(undefined,{weekday:'long', month:'long', day:'numeric', year:'numeric'});

  var scraped = new Date(SCRAPED_AT);
  var ageH = (now - scraped) / 36e5;
  var fresh = document.getElementById('freshness');
  var SEEDED = ${snapshot.seeded ? "true" : "false"};
  fresh.textContent = (SEEDED ? 'Seeded ' : 'Last scrape: ') + scraped.toLocaleString(undefined,
    {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}) +
    (!SEEDED && ageH > 36 ? ' — more than a day old' : SEEDED ? ' — awaiting the first automatic run' : '');
  if (!SEEDED && ageH > 36) fresh.classList.add('stale');

  function status(d){
    if (!d) return 'later';
    var diffH = (d - now) / 36e5;
    if (diffH < 0) return 'overdue';
    if (diffH <= 72) return 'soon';
    return 'later';
  }
  function fmtDate(d){
    if (!d) return 'no due date';
    return d.toLocaleDateString(undefined,{month:'short', day:'numeric'}) + ' ' +
           d.toLocaleTimeString(undefined,{hour:'numeric', minute:'2-digit'});
  }
  function shortDate(d){ return d.toLocaleDateString(undefined,{month:'short', day:'numeric'}); }

  function scoreCell(i){
    if (i.score === null || i.score === undefined){
      return '<span class="iscore ungraded">—</span>';
    }
    var text = i.possible ? (i.score + '/' + i.possible) : String(i.score);
    var band = '';
    if (i.possible){
      var pct = i.score / i.possible;
      band = pct >= 0.9 ? ' good' : pct >= 0.8 ? ' mid' : ' low';
    }
    return '<span class="iscore' + band + '">' + text + '</span>';
  }

  var forward = items.filter(function(i){ return !i.minor && i.due && i.due >= now; })
    .sort(function(a,b){ return a.due - b.due; }).slice(0,5);
  if (forward.length === 0){
    forward = items.filter(function(i){ return !i.minor && i.due; })
      .sort(function(a,b){ return a.due-b.due; }).slice(-5);
  }
  var fList = document.getElementById('forwardList');
  forward.forEach(function(i){
    var li = document.createElement('li');
    li.innerHTML = '<span class="fdate">'+shortDate(i.due)+'</span>' +
      '<span class="fcourse '+group(i.course)+'">'+shortCode(i.course)+'</span>' +
      '<span class="ftitle">'+i.title+'</span>';
    fList.appendChild(li);
  });

  function weekStart(d){
    var wd = (d.getDay()+6)%7;
    var s = new Date(d); s.setHours(0,0,0,0); s.setDate(s.getDate()-wd);
    return s;
  }
  var groups = {};
  var undated = [];
  items.sort(function(a,b){
    if (!a.due) return 1; if (!b.due) return -1; return a.due-b.due;
  }).forEach(function(i){
    if (!i.due){ undated.push(i); return; }
    var ws = weekStart(i.due).getTime();
    (groups[ws] = groups[ws] || []).push(i);
  });
  var weekKeys = Object.keys(groups).sort(function(a,b){ return a-b; });
  var curWeek = weekStart(now).getTime();

  var savedState = {};
  try { savedState = JSON.parse(localStorage.getItem('termboard-weeks') || '{}'); } catch(e){ savedState = {}; }

  var weeksEl = document.getElementById('weeks');

  function renderRow(i){
    var st = status(i.due);
    var row = document.createElement('div');
    row.className = 'item status-'+st + (i.minor ? ' minor' : '');
    if (i.minor) row.style.display = 'none';
    var stripeColor = st==='overdue' ? 'var(--danger)' : (st==='soon' ? 'var(--warn)' : 'var(--line)');
    row.innerHTML =
      '<span class="idate">'+fmtDate(i.due)+'</span>' +
      '<span class="icourse '+group(i.course)+'">'+shortCode(i.course)+'</span>' +
      '<span class="ititle" style="border-left:3px solid '+stripeColor+'; padding-left:8px;">'+i.title+
        (i.flagged ? ' <span class="flag-chip" title="The reading behind this did not extract as clean text — it will not work well read aloud.">no clean text</span>' : '') +
      '</span>' +
      '<span class="icat">'+i.cat+'</span>' +
      scoreCell(i);
    return row;
  }

  weekKeys.forEach(function(wk){
    var list = groups[wk];
    var ws = new Date(parseInt(wk,10));
    var we = new Date(ws); we.setDate(we.getDate()+6);
    var isDefaultOpen = (parseInt(wk,10) >= curWeek - 7*86400000) && (parseInt(wk,10) <= curWeek + 14*86400000);
    var openState = savedState.hasOwnProperty(wk) ? savedState[wk] : isDefaultOpen;

    var weekEl = document.createElement('div');
    weekEl.className = 'week' + (openState ? ' open' : '');
    weekEl.dataset.wk = wk;

    var majorCount = list.filter(function(i){ return !i.minor; }).length;
    var minorCount = list.length - majorCount;

    var head = document.createElement('div');
    head.className = 'week-head';
    head.innerHTML = '<span class="wtitle">'+shortDate(ws)+' – '+shortDate(we)+'</span>' +
      '<span class="wmeta">'+majorCount+' item'+(majorCount===1?'':'s')+
        (minorCount? ' + '+minorCount+' drill'+(minorCount===1?'':'s'):'')+'</span>' +
      '<span class="chev">▸</span>';
    head.addEventListener('click', function(){
      weekEl.classList.toggle('open');
      savedState[wk] = weekEl.classList.contains('open');
      try { localStorage.setItem('termboard-weeks', JSON.stringify(savedState)); } catch(e){}
    });

    var body = document.createElement('div');
    body.className = 'week-body';
    list.forEach(function(i){ body.appendChild(renderRow(i)); });

    weekEl.appendChild(head);
    weekEl.appendChild(body);
    weeksEl.appendChild(weekEl);
  });

  if (undated.length){
    var weekEl = document.createElement('div');
    weekEl.className = 'week';
    var head = document.createElement('div');
    head.className = 'week-head';
    head.innerHTML = '<span class="wtitle">No due date</span>' +
      '<span class="wmeta">'+undated.length+' item'+(undated.length===1?'':'s')+'</span>' +
      '<span class="chev">▸</span>';
    head.addEventListener('click', function(){ weekEl.classList.toggle('open'); });
    var body = document.createElement('div');
    body.className = 'week-body';
    undated.forEach(function(i){ body.appendChild(renderRow(i)); });
    weekEl.appendChild(head); weekEl.appendChild(body);
    weeksEl.appendChild(weekEl);
  }

  var showingMinor = false;
  document.getElementById('drillToggle').addEventListener('click', function(){
    showingMinor = !showingMinor;
    document.querySelectorAll('.item.minor').forEach(function(el){
      el.style.display = showingMinor ? 'grid' : 'none';
    });
    this.textContent = showingMinor ? 'Hide daily drills & verb charts' : 'Show daily drills & verb charts';
  });
})();
</script>
`;
}
