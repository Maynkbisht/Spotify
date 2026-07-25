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

// ---------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------
// Avoids re-fetching info.json every time an already-visited album is
// clicked again.
const albumInfoCache = new Map(); // folder -> { artist, songs }

// Avoids re-downloading and re-parsing a song's embedded art every time
// its album is revisited. Value is the resolved art data-URI, or null if
// the song has no embedded art (so we don't keep retrying it either).
const coverArtCache = new Map(); // "folder/song" -> artUrl | null

// reads a song's own embedded ID3 cover art (not the album's cover.png).
// Resolves to a base64 data URI if the mp3 has embedded art, or null if it
// doesn't (or jsmediatags isn't available), so callers can fall back cleanly.
//
// IMPORTANT: we fetch the file as a Blob ourselves and hand that to
// jsmediatags, instead of letting it fetch the URL directly. jsmediatags'
// URL reader relies on HTTP Range requests, which many local dev servers
// (e.g. VS Code Live Server) don't support — causing every read to fail
// silently and always fall back to the album cover.
//
// We also ask for only the first 512KB of the file via a Range header.
// ID3v2 tags (including embedded art) live at the start of the file, so
// there's normally no need to download the whole track — often several
// MB — just to read a few KB of metadata. This is the single biggest
// win for perceived load speed: it stops metadata reads from competing
// with the actual audio stream for bandwidth and connections. If the
// server ignores Range and returns the full file, this still works
// correctly, just without the savings.
function getEmbeddedCoverArt(folder, song, signal) {
  const cacheKey = `${folder}/${song}`;
  if (coverArtCache.has(cacheKey)) {
    return Promise.resolve(coverArtCache.get(cacheKey));
  }

  return new Promise(async (resolve) => {
    if (typeof window.jsmediatags === "undefined") {
      resolve(null);
      return;
    }
    try {
      let fileResponse = await fetch(`/${folder}/${song}`, {
        signal,
        headers: { Range: "bytes=0-524287" },
      });
      let fileBlob = await fileResponse.blob();

      window.jsmediatags.read(fileBlob, {
        onSuccess: (tag) => {
          let picture = tag.tags.picture;
          if (!picture) {
            coverArtCache.set(cacheKey, null);
            resolve(null);
            return;
          }
          let base64String = "";
          for (let i = 0; i < picture.data.length; i++) {
            base64String += String.fromCharCode(picture.data[i]);
          }
          let artUrl = `data:${picture.format};base64,${window.btoa(base64String)}`;
          coverArtCache.set(cacheKey, artUrl);
          resolve(artUrl);
        },
        onError: (error) => {
          // "No suitable tag reader found" just means this file has no
          // ID3v2 tag at the front (e.g. it only has a trailing ID3v1
          // tag, which can't hold artwork anyway, or no tag at all).
          // That's a normal, expected outcome for a lot of tracks, not a
          // real failure — so it's not worth logging. Anything else is
          // unexpected and still worth knowing about.
          if (error?.info !== "No suitable tag reader found") {
            console.log(`Could not read tags for ${song}`, error);
          }
          coverArtCache.set(cacheKey, null);
          resolve(null);
        },
      });
    } catch (err) {
      // AbortError is expected when the user switches albums quickly —
      // not a real failure, so don't clutter the console, and don't
      // cache it either since we never actually got an answer.
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

// Fetches embedded art for a batch of songs with only a small number of
// requests in flight at once (instead of firing every song's fetch
// simultaneously). This keeps the album's own cover-art work from
// starving the actual audio playback request and other page traffic of
// connections, which is what was causing the sluggish, stuttery
// switching between albums/songs.
async function loadEmbeddedArtForAlbum(folder, songList, loadId, signal, songUL) {
  const CONCURRENCY = 2;
  let index = 0;

  async function worker() {
    while (index < songList.length) {
      if (loadId !== activeLoadId) return;
      const song = songList[index++];
      let artUrl = await getEmbeddedCoverArt(folder, song, signal);
      if (loadId !== activeLoadId || !artUrl) continue;
      let li = Array.from(songUL.getElementsByTagName("li")).find(
        (item) => item.dataset.song === song,
      );
      if (li) {
        let img = li.querySelector(".songCover");
        if (img) img.src = artUrl;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
}

async function getSongs(folder) {
  currFolder = folder;
  const loadId = ++activeLoadId;

  // Cancel any embedded-art fetches still running from a previous album
  // switch, freeing up connections for this album's requests instead of
  // competing with them.
  if (activeArtController) activeArtController.abort();
  const artController = new AbortController();
  activeArtController = artController;
  let albumInfo = { artist: "Unknown Artist", songs: [] };

  if (albumInfoCache.has(folder)) {
    albumInfo = albumInfoCache.get(folder);
  } else {
    try {
      let infoResponse = await fetch(`/${folder}/info.json`);
      if (infoResponse.ok) {
        albumInfo = await infoResponse.json();
        albumInfoCache.set(folder, albumInfo);
      }
    } catch (err) {
      console.log(`Could not load info.json for ${folder}`);
    }
  }

  songs = albumInfo.songs || [];
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
    // If we already know this song's embedded art from a previous visit,
    // show it immediately instead of the album cover + a flash later.
    const cachedArt = coverArtCache.get(`${folder}/${song}`);
    const initialCover = cachedArt || coverPath;
    songUL.innerHTML += `
<li data-song="${song}">
    <img class="songCover" src="${initialCover}" alt="cover" />
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
  // album cover already shown if a song has no embedded art). Only songs
  // not already in the cache need a network request; fetches for those
  // are limited to a couple in flight at once (see
  // loadEmbeddedArtForAlbum) so they don't starve playback of bandwidth.
  // Every step re-checks loadId, so a rapid album switch cleanly cancels
  // this work instead of letting it trickle in and overwrite the newer
  // album's list.
  const uncached = songs.filter((song) => !coverArtCache.has(`${folder}/${song}`));
  if (uncached.length > 0) {
    loadEmbeddedArtForAlbum(folder, uncached, loadId, artController.signal, songUL);
  }

  return songs;
}

// Guards against rapid clicks racing each other: if the user clicks two
// songs in quick succession, only the *latest* click should ever end up
// updating the UI or holding onto the play() promise.
let playLoadId = 0;

const playMusic = (track, pause = false) => {
  if (!track) return; // guards against being called with a stale/empty track

  const thisPlayId = ++playLoadId;
  currentSong.src = `/${currFolder}/${track}`;

  document.querySelector(".songInfo").innerHTML = decodeURI(track).replace(
    ".mp3",
    "",
  );
  document.querySelector(".songTime").innerHTML = "00:00 / 00:00";

  if (!pause) {
    const playPromise = currentSong.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          if (thisPlayId === playLoadId) {
            play.src = "./img/pause.svg";
          }
        })
        .catch((err) => {
          // Expected and harmless: happens whenever a newer track starts
          // loading before this play() resolved. Anything else is worth
          // knowing about.
          if (err.name !== "AbortError") {
            console.log("Playback failed", err);
          }
        });
    } else {
      play.src = "./img/pause.svg";
    }
  }
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
  if (!songs || songs.length === 0) return;
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
    currentSong.play().catch((err) => {
      if (err.name !== "AbortError") console.log("Playback failed", err);
    });
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

let albumsCache = null;

async function displayAlbums() {
  if (!albumsCache) {
    const response = await fetch("/songs/albums.json");
    albumsCache = await response.json();
  }
  const albums = albumsCache;

  const cardContainer = document.querySelector(".cardContainer");
  cardContainer.innerHTML = "";

  albums.forEach((album) => {
    cardContainer.innerHTML += `
      <div data-folder="${album.folder}" class="card">
        <div class="imgContainer">
          <div class="play">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="30" fill="#1ED760"/>
              <polygon points="26,20 26,44 46,32" fill="#000000"/>
            </svg>
          </div>

          <img src="/songs/${album.folder}/cover.png" alt="${album.title}" />
        </div>

        <h3>${album.title}</h3>
        <p>${album.artist}</p>
      </div>
    `;
  });

  document.querySelectorAll(".card").forEach((card) => {
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
  if (songs.length > 0) {
    playMusic(songs[0], true);
  }

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
    if (!songs || songs.length === 0) return;
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
