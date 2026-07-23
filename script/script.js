let currentSong = new Audio();
let songs;
let currFolder = "Cigarettes After Sex";
let currentArtist = "Cigarettes After Sex"; // tracks artist of the currently selected album

function secondsToMinutesSeconds(seconds) {
  if (isNaN(seconds) || seconds < 0) {
    return "00:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  const formattedMinutes = String(minutes).padStart(2, "0");
  const formattedSeconds = String(remainingSeconds).padStart(2, "0");
  return `${formattedMinutes}:${formattedSeconds}`;
}

// reads a song's own embedded ID3 cover art (not the album's cover.png).
// Resolves to a base64 data URI if the mp3 has embedded art, or null if it
// doesn't (or jsmediatags isn't available), so callers can fall back cleanly.
// IMPORTANT: we fetch the file as a Blob ourselves and hand that to
// jsmediatags, instead of letting it fetch the URL directly. jsmediatags'
// URL reader relies on HTTP Range requests, which many local dev servers
// (e.g. VS Code Live Server) don't support — causing every read to fail
// silently and always fall back to the album cover.

function getEmbeddedCoverArt(folder, song, signal) {
  return new Promise(async (resolve) => {
    if (typeof window.jsmediatags === "undefined") {
      resolve(null);
      return;
    }
    try {
      let fileResponse = await fetch(`/${folder}/${song}`, { signal });
      let fileBlob = await fileResponse.blob();

      window.jsmediatags.read(fileBlob, {
        onSuccess: (tag) => {
          let picture = tag.tags.picture;
          if (!picture) {
            resolve(null);
            return;
          }
          let base64String = "";
          for (let i = 0; i < picture.data.length; i++) {
            base64String += String.fromCharCode(picture.data[i]);
          }
          resolve(
            `data:${picture.format};base64,${window.btoa(base64String)}`,
          );
        },
        onError: (error) => {
          console.log(`Could not read tags for ${song}`, error);
          resolve(null);
        },
      });
    } catch (err) {
      // AbortError is expected when the user switches albums quickly —
      // not a real failure, so don't clutter the console with it
      if (err.name !== "AbortError") {
        console.log(`Could not fetch ${song} for tag reading`, err);
      }
      resolve(null);
    }
  });
}

// tracks which getSongs() call is the most recent one, and lets us
// cancel the previous album's still-in-flight art fetches when the user
// switches albums quickly. Without this, fast switching piles up requests
// that compete for the browser's limited connection pool, and a slow
// previous request can even finish AFTER the new one and overwrite it with
// stale data.

let activeLoadId = 0;
let activeArtController = null;

async function getSongs(folder) {
  currFolder = folder;
  const loadId = ++activeLoadId;

  // Cancel any embedded-art fetches still running from a previous album
  // switch, freeing up connections for this album's requests instead of
  // competing with them.
  if (activeArtController) activeArtController.abort();
  const artController = new AbortController();
  activeArtController = artController;

  let directory = await fetch(`/${folder}/`);

  let response = await directory.text();
  let div = document.createElement("div");

  div.innerHTML = response;
  let as = div.getElementsByTagName("a");
  songs = [];
  for (let index = 0; index < as.length; index++) {
    const element = as[index];
    if (element.href.endsWith(".mp3")) {
      songs.push(decodeURIComponent(element.href.split("/").pop()));
    }
  }

  // bail out if a newer album switch happened while we were fetching —
  // no point rendering a list the user has already moved on from
  if (loadId !== activeLoadId) return songs;

  // fetch this album's info.json so we can show the correct artist name
  let albumInfo = { artist: "Unknown Artist" };
  try {
    let infoResponse = await fetch(`/${folder}/info.json`);
    if (infoResponse.ok) {
      albumInfo = await infoResponse.json();
    }
  } catch (err) {
    console.log(`Could not load info.json for ${folder}`);
  }
  currentArtist = albumInfo.artist || "Unknown Artist";

  // bail out again — this fetch was also racing against a possible
  // newer switch
  if (loadId !== activeLoadId) return songs;

  // album cover is only the fallback now — used until (or unless) a
  // song's own embedded art is found
  let coverPath = `/${folder}/cover.png`;

  // show all the songs in the playlist
  let songUL = document
    .querySelector(".songList")
    .getElementsByTagName("ul")[0];
  songUL.innerHTML = "";

  for (const song of songs) {
    songUL.innerHTML += `
<li data-song="${song}">
    <img class="songCover" src="${coverPath}" alt="cover" />
    <div class="info">
        <div>${decodeURIComponent(song).replace(".mp3", "")}</div>
        <div>${currentArtist}</div>
    </div>
    <div class="playnow">
        <span>Play Now</span>
        <img class="white-icon songStateIcon" src="./img/play.svg" alt="play" />
    </div>
</li>`;
  }

  //attach a eventlistner to each song
  Array.from(
    document.querySelector(".songList").getElementsByTagName("li"),
  ).forEach((element) => {
    element.addEventListener("click", () => {
      playMusic(element.dataset.song);
    });
  });

  // swap each song's icon to its own embedded cover art as it loads,
  // without blocking the initial render of the list (falls back to the
  // album cover already shown if a song has no embedded art). Each fetch
  // carries the AbortSignal for this album load, and every step re-checks
  // loadId, so a rapid album switch cleanly cancels this work instead of
  // letting it trickle in and overwrite the newer album's list.
  songs.forEach(async (song) => {
    let artUrl = await getEmbeddedCoverArt(folder, song, artController.signal);
    if (loadId !== activeLoadId || !artUrl) return;
    let li = Array.from(songUL.getElementsByTagName("li")).find(
      (item) => item.dataset.song === song,
    );
    if (li) {
      let img = li.querySelector(".songCover");
      if (img) img.src = artUrl;
    }
  });

  return songs;
}

const playMusic = (track, pause = false) => {
  currentSong.src = `/${currFolder}/${track}`;

  if (!pause) {
    currentSong.play();
    play.src = "./img/pause.svg";
  }

  document.querySelector(".songInfo").innerHTML = decodeURI(track).replace(
    ".mp3",
    "",
  );
  document.querySelector(".songTime").innerHTML = "00:00 / 00:00";
};

// keeps every sidebar song icon in sync with what's actually playing.
// Runs on every native play/pause event, so there is never more than one
// pause icon showing at a time, and it self-corrects regardless of what
// triggered the play/pause (button, sidebar click, next/prev, ended, etc).
function updateSongIcons() {
  let currentTrack = decodeURIComponent(currentSong.src.split("/").pop());
  Array.from(
    document.querySelector(".songList").getElementsByTagName("li"),
  ).forEach((li) => {
    let icon = li.querySelector(".songStateIcon");
    if (!icon) return;
    if (li.dataset.song === currentTrack && !currentSong.paused) {
      icon.src = "./img/pause.svg";
    } else {
      icon.src = "./img/play.svg";
    }
  });
}

// reusable next-song logic (used by both the next button and the
// "ended" event so the album auto-advances when a track finishes)
function playNextSong() {
  let currentTrack = decodeURIComponent(currentSong.src.split("/").pop());
  let index = songs.indexOf(currentTrack);
  if (index === songs.length - 1) {
    playMusic(songs[0]);
  } else {
    playMusic(songs[index + 1]);
  }
}

// reusable play/pause toggle — used by the play button and the Tab
// keyboard shortcut. The actual icon updates happen via the "play"/"pause"
// listeners on currentSong (see main()), so this only needs to flip state.
function togglePlayPause() {
  if (currentSong.paused) {
    currentSong.play();
  } else {
    currentSong.pause();
  }
}

// reusable mute toggle — used by the volume icon and the M keyboard
// shortcut. Takes the volume <img> element so both callers stay in sync.
function toggleMute(volumeImg) {
  currentSong.muted = !currentSong.muted;
  volumeImg.src = currentSong.muted ? "./img/mute.svg" : "./img/volume.svg";
}

async function displayAlbums() {
  // Fetch the songs directory
  let directory = await fetch("/songs/");
  let response = await directory.text();

  let div = document.createElement("div");
  div.innerHTML = response;

  let anchors = div.getElementsByTagName("a");
  let cardContainer = document.querySelector(".cardContainer");

  // Clear existing cards
  cardContainer.innerHTML = "";

  let array = Array.from(anchors);

  // pull out just the valid album folder names first (skip the parent
  // /songs/ link and .htaccess), so we know exactly what to fetch
  let folders = array
    .filter(
      (e) =>
        e.href.includes("/songs/") &&
        !e.href.endsWith("/songs/") &&
        !e.href.includes(".htaccess"),
    )
    .map((e) => e.href.split("/").slice(-2)[0]);

  // fetch every album's info.json IN PARALLEL instead of one at a time.
  // The old code had `await` inside a for loop, so album 2 didn't even
  // start fetching until album 1 finished — with ~10 albums that adds up
  // fast. Promise.all fires them all at once; total time becomes roughly
  // the slowest single request instead of the sum of all of them.
  let albumInfos = await Promise.all(
    folders.map(async (folder) => {
      try {
        let info = await fetch(`/songs/${folder}/info.json`);
        if (!info.ok) {
          console.log(`info.json not found for ${folder}`);
          return null;
        }
        let data = await info.json();
        return { folder, data };
      } catch (err) {
        console.error(`Error loading ${folder}:`, err);
        return null;
      }
    }),
  );

  // Build the cards now that all the data has arrived (order preserved,
  // since Promise.all resolves in the same order the promises were created)
  albumInfos.forEach((album) => {
    if (!album) return;
    const { folder, data } = album;

    cardContainer.innerHTML += `
          <div data-folder="${folder}" class="card">
          <div class="imgContainer">
            <div class="play">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width: 100%;
                height: 100%;
                viewBox="0 0 64 64"
              >
                <circle cx="32" cy="32" r="30" fill="#1ED760"/>
                <polygon points="26,20 26,44 46,32" fill="#000000"/>
              </svg>
            </div>

            <img
              src="/songs/${folder}/cover.png"
              alt="${data.title}"
            />
             </div>

            <h3>${data.title}</h3>
            <p>${data.artist}</p>
          </div>
        `;
  });

  // Add click listeners after all cards are created
  Array.from(document.querySelectorAll(".card")).forEach((card) => {
    card.addEventListener("click", async () => {
      songs = await getSongs(`songs/${card.dataset.folder}`);
      playMusic(songs[0]);
    });
  });
}

async function main() {
  // kick off the default song list AND the album grid at the same
  // time. Previously `displayAlbums()` only started after `getSongs()`
  // fully resolved — including every embedded-cover-art Blob fetch — so
  // the album grid was stuck waiting on unrelated work before it even began.
  let songsPromise = getSongs(`songs/${currFolder}/`);
  displayAlbums();
  await songsPromise;

  //default music
  playMusic(songs[7], true);

  // attach an eventlistner to play pause next
  play.addEventListener("click", () => {
    togglePlayPause();
  });

  //add event listner for time update of song
  currentSong.addEventListener("timeupdate", () => {
    document.querySelector(".songTime").innerHTML =
      `${secondsToMinutesSeconds(currentSong.currentTime)} / ${secondsToMinutesSeconds(currentSong.duration)}`;

    document.querySelector(".circle").style.left =
      (currentSong.currentTime / currentSong.duration) * 100 + "%";
  });

  // auto-play the next song in the album when the current one finishes
  currentSong.addEventListener("ended", () => {
    playNextSong();
  });

  // keep sidebar play/pause icons in sync with the actual audio state,
  // no matter what triggered the change
  currentSong.addEventListener("play", () => {
    play.src = "./img/pause.svg";
    updateSongIcons();
  });

  currentSong.addEventListener("pause", () => {
    play.src = "./img/play.svg";
    updateSongIcons();
  });

  document.querySelector(".seekbar").addEventListener("click", (e) => {
    let time = (e.offsetX / e.target.getBoundingClientRect().width) * 100;
    document.querySelector(".circle").style.left = time + "%";
    currentSong.currentTime = (currentSong.duration * time) / 100;
  });

  //add an event listener for hamburger
  document.querySelector(".hamburger").addEventListener("click", () => {
    document.querySelector("aside").style.left = "0";
  });

  //add an event listner to close hamburger
  document.querySelector("aside .close").addEventListener("click", () => {
    document.querySelector("aside").style.left = "-120%";
  });

  //add an event listner for previous
  previous.addEventListener("click", () => {
    let currentTrack = decodeURIComponent(currentSong.src.split("/").pop());
    let index = songs.indexOf(currentTrack);
    if (index <= 0) {
      playMusic(songs[songs.length - 1]);
    } else {
      playMusic(songs[index - 1]);
    }
  });

  //add an event listner for  next
  next.addEventListener("click", () => {
    playNextSong();
  });

  const volumeSlider = document.querySelector(".range input");
  const volumeImg = document.querySelector(".volume img");

  // Slider
  volumeSlider.addEventListener("input", (e) => {
    currentSong.volume = e.target.value / 100;
  });

  // Mute button
  volumeImg.addEventListener("click", () => {
    toggleMute(volumeImg);
  });

  // keyboard shortcuts — Tab or Space toggles play/pause, M toggles
  // mute. preventDefault stops Tab from shifting keyboard focus and Space
  // from scrolling the page, since both are repurposed as playback controls.
  
  document.addEventListener("keydown", (e) => {
    if (e.key === "Tab" || e.key === " " || e.code === "Space") {
      e.preventDefault();
      togglePlayPause();
    } else if (e.key.toLowerCase() === "m") {
      toggleMute(volumeImg);
    }
  });
}

main();