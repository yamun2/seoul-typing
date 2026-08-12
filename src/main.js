import "./style.css";
import * as d3 from "d3";
import { seoulDongs } from "./data/seoulDongs";
import { seoulGuOrder } from "./data/seoulGuOrder";
import { supabase } from "./supabase";
import { koreaRegions } from "./data/koreaRegions";
import { inject } from "@vercel/analytics";

inject();

const app = document.querySelector("#app");

function getSortedKoreaRegions() {
  return Object.keys(koreaRegions).sort((a, b) => {

    // 서울은 무조건 맨 위
    if (a === "서울특별시") return -1;
    if (b === "서울특별시") return 1;

    // 나머지는 가나다순
    return a.localeCompare(b, "ko");
  });
}

let guSvg = null;
let guPaths = null;
let guLabels = null;

let gameMode = "region";
let tourGuIndex = 0;
let tourResults = [];

let tourStartTime = null;
let tourKeyStrokeCount = 0;
let tourAccuracyCorrect = 0;
let tourAccuracyWrong = 0;

let tourTotalDongCount = 0;
let tourCompletedDongCount = 0;
let currentGameSessionId = null;
let currentGameSessionPromise = null;

async function startGameSession(
  mode,
  targetRegion
) {

  const {
    data: { user }
  } =
    await supabase.auth.getUser();


  // 비로그인 플레이는
  // 세션을 만들지 않고 그대로 게임 허용
  if (!user) {
    return null;
  }


  const {
    data,
    error
  } =
    await supabase.functions.invoke(
      "start-game-session",
      {
        body: {
          mode,
          target_region:
            targetRegion
        }
      }
    );


  if (
    error ||
    !data?.success ||
    !data?.session_id
  ) {

    console.error(
      "게임 세션 생성 실패:",
      error ||
      data?.error
    );

    return null;
  }


  currentGameSessionId =
    data.session_id;


  console.log(
    "게임 세션 생성 성공:",
    currentGameSessionId
  );


  return currentGameSessionId;
}

/* =========================================================
   SETTINGS
========================================================= */

const DEFAULT_SETTINGS = {
  sound: true,
  mapSize: "medium",
  labelSize: "medium",
  targetTextSize: "medium"
};


function loadGameSettings() {
  const saved =
    localStorage.getItem(
      "seoulTypingSettings"
    );

  if (!saved) {
    return {
      ...DEFAULT_SETTINGS
    };
  }

  try {
    return {
      ...DEFAULT_SETTINGS,
      ...JSON.parse(saved)
    };
  } catch {
    return {
      ...DEFAULT_SETTINGS
    };
  }
}


function saveGameSettings(settings) {
  localStorage.setItem(
    "seoulTypingSettings",
    JSON.stringify(settings)
  );
}


let gameSettings =
  loadGameSettings();

  /* =========================================================
   SOUND EFFECTS
========================================================= */

let soundAudioContext = null;


/* =========================================================
   SOUND FILES

   public/sounds/
   ├── typing.wav
   ├── back.wav
   └── tour.wav
========================================================= */

const typingSoundUrl =
  "/sounds/typing.wav";

const backSoundUrl =
  "/sounds/back.wav";

const tourSoundUrl =
  "/sounds/tour.wav";


/* =========================================================
   AUDIO OBJECTS
========================================================= */

const typingSound =
  new Audio(
    typingSoundUrl
  );

const backSound =
  new Audio(
    backSoundUrl
  );

const tourSound =
  new Audio(
    tourSoundUrl
  );


typingSound.preload =
  "auto";

backSound.preload =
  "auto";

tourSound.preload =
  "auto";


/* =========================================================
   VOLUME

   0 = 무음
   1 = 최대
========================================================= */

typingSound.volume =
  0.18;

/*
  Backspace는 타자음보다
  살짝 작게 설정
*/

backSound.volume =
  0.16;

tourSound.volume =
  0.23;


/* =========================================================
   WEB AUDIO CONTEXT
========================================================= */

function getSoundAudioContext() {

  if (!soundAudioContext) {

    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;


    if (!AudioContextClass) {
      return null;
    }


    soundAudioContext =
      new AudioContextClass();

  }


  return soundAudioContext;
}


/* =========================================================
   SOUND EFFECT PLAYER
========================================================= */

function playSoundEffect(type) {

  if (!gameSettings.sound) {
    return;
  }


  /* =========================================================
     일반 타자 입력
  ========================================================= */

  if (type === "typing") {

    /*
      빠르게 입력해도
      효과음이 겹쳐 재생되도록
      매번 새 Audio 객체 생성
    */

    const sound =
      new Audio(
        typingSoundUrl
      );


    sound.volume =
      typingSound.volume;


    sound
      .play()
      .catch(error => {

        console.debug(
          "타자 효과음 재생 실패:",
          error
        );

      });


    return;
  }


  /* =========================================================
     BACKSPACE
  ========================================================= */

  if (type === "back") {

    /*
      Backspace를 빠르게 연속으로 눌러도
      각각 소리가 나도록 새 Audio 생성
    */

    const sound =
      new Audio(
        backSoundUrl
      );


    sound.volume =
      backSound.volume;


    sound
      .play()
      .catch(error => {

        console.debug(
          "삭제 효과음 재생 실패:",
          error
        );

      });


    return;
  }


  /* =========================================================
     서울 종주 / 지역 완료
  ========================================================= */

  if (type === "tour") {

    tourSound.currentTime =
      0;


    tourSound
      .play()
      .catch(error => {

        console.debug(
          "완료 효과음 재생 실패:",
          error
        );

      });


    return;
  }


  /* =========================================================
     기존 Web Audio 효과음
  ========================================================= */

  const audioContext =
    getSoundAudioContext();


  if (!audioContext) {
    return;
  }


  if (
    audioContext.state ===
    "suspended"
  ) {

    audioContext.resume();

  }


  const now =
    audioContext.currentTime;


  function playTone(
    frequency,
    start = 0,
    duration = 0.08,
    volume = 0.06,
    waveType = "sine"
  ) {

    const oscillator =
      audioContext.createOscillator();


    const gain =
      audioContext.createGain();


    oscillator.type =
      waveType;


    oscillator.frequency
      .setValueAtTime(
        frequency,
        now + start
      );


    gain.gain
      .setValueAtTime(
        volume,
        now + start
      );


    gain.gain
      .exponentialRampToValueAtTime(
        0.001,
        now + start + duration
      );


    oscillator.connect(
      gain
    );


    gain.connect(
      audioContext.destination
    );


    oscillator.start(
      now + start
    );


    oscillator.stop(
      now + start + duration
    );

  }


  /* =========================================================
     동 하나 입력 완료
  ========================================================= */

  if (type === "dong") {

    playTone(
      520,
      0,
      0.055,
      0.050,
      "sine"
    );


    playTone(
      720,
      0.045,
      0.075,
      0.058,
      "sine"
    );


    return;
  }


  /* =========================================================
     3 · 2 · 1 카운트다운
  ========================================================= */

  if (
    type ===
    "countdown"
  ) {

    playTone(
      440,
      0,
      0.09,
      0.065,
      "sine"
    );


    return;
  }


  /* =========================================================
     구 하나 완료
  ========================================================= */

  if (type === "gu") {

    playTone(
      523,
      0,
      0.11,
      0.070,
      "sine"
    );


    playTone(
      659,
      0.09,
      0.11,
      0.075,
      "sine"
    );


    playTone(
      784,
      0.18,
      0.18,
      0.082,
      "sine"
    );


    return;
  }

}

async function showHomeScreen() {

  const {
    data: { user }
  } =
    await supabase.auth.getUser();


  const nickname =
    user?.user_metadata?.nickname ||
    null;


  /*
    나중에 네 인스타 아이디만
    YOUR_ID 부분에 넣으면 됨.
  */

  const instagramUrl =
  "https://www.instagram.com/seoul_typing";


  app.innerHTML = `
    <main id="home-screen">

      <div class="home-content home-redesign">


        <!-- =========================================
             TOP BAR
        ========================================== -->

        <header class="home-topbar">

          <div class="home-brand-new">
            seoul typing
          </div>


          <button
            id="login-button"
            class="home-login-button"
            type="button"
          >

            <span class="home-login-icon">
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="8"
                  r="3.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                />

                <path
                  d="M5.5 19c.6-4 3-6 6.5-6s5.9 2 6.5 6"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                />
              </svg>
            </span>

            ${
              user
                ? nickname || "내 정보"
                : "로그인"
            }

          </button>

        </header>



        <!-- =========================================
             HERO
        ========================================== -->

        <section class="home-hero-new">

          <h1>
            <span class="home-title-seoul">
              서울
            </span>

            <span class="home-title-typing">
              타이핑
            </span>
          </h1>


          <p>
            25개 구를 타이핑하며 서울을 완주해보자!
          </p>


          <!-- 서울 실루엣 -->

          <div
            class="home-seoul-skyline"
            aria-hidden="true"
          >

            <svg viewBox="0 0 1000 150">

              <!-- 남산타워 -->

              <g class="skyline-stroke">

                <path d="
                  M110 132
                  V78
                  M102 78
                  H118
                  M106 78
                  L110 38
                  L114 78
                  M108 49
                  H112
                  M110 38
                  V20
                " />


                <!-- 전통 건축 -->

                <path d="
                  M190 132
                  V104
                  H254
                  V132

                  M180 104
                  H264

                  M192 104
                  L202 91
                  H242
                  L252 104

                  M205 91
                  V78
                  H239
                  V91

                  M197 78
                  H247

                  M210 132
                  V112

                  M234 132
                  V112
                " />


                <!-- 건물 -->

                <path d="
                  M290 132
                  V98
                  H310
                  V132

                  M320 132
                  V83
                  H346
                  V132

                  M356 132
                  V105
                  H380
                  V132
                " />


                <!-- 한강대교 느낌 -->

                <path d="
                  M410 132
                  H590

                  M420 118
                  C445 87 475 87 500 118

                  M500 118
                  C525 87 555 87 580 118

                  M430 118
                  V132
                  M470 106
                  V132
                  M530 106
                  V132
                  M570 118
                  V132
                " />


                <!-- 동대문 DDP 느낌 -->

                <path d="
                  M625 132
                  C626 105 645 91 681 93
                  C714 95 732 107 734 132
                  Z
                " />


                <!-- 고층 건물 -->

                <path d="
                  M775 132
                  V90
                  H794
                  V132

                  M803 132
                  V72
                  H824
                  V132
                " />


                <!-- 롯데타워 느낌 -->

                <path d="
                  M865 132
                  L880 43
                  L895 132
                  Z

                  M880 43
                  V20
                " />

              </g>

            </svg>

          </div>

        </section>



        <!-- =========================================
             MENU
        ========================================== -->

        <section class="home-menu home-menu-new">


          <!-- 서울 종주 -->

          <button
            id="seoul-tour-button"
            class="
              home-card
              home-tour-card
              home-card-redesign
            "
            type="button"
          >

            <div class="home-card-copy">

              <span class="home-card-number">
                01
              </span>

              <h2>
                서울 종주
              </h2>

              <p>
                서울 25개 구를 처음부터 끝까지!
              </p>

            </div>


            <div
              class="home-redesign-visual tour"
              aria-hidden="true"
            >

              <svg viewBox="0 0 260 150">

                <path
                  class="tour-cloud"
                  d="
                    M43 115
                    C18 92 29 61 60 56
                    C75 26 113 27 129 49
                    C150 30 183 39 194 61
                    C226 60 238 88 221 110
                    C202 130 173 124 157 116
                    C137 134 101 128 92 114
                    C70 125 54 123 43 115Z
                  "
                />

                <path
                  class="tour-route"
                  d="
                    M90 45
                    C90 67 151 61 143 84
                    C137 100 105 96 115 113
                    C125 127 165 116 188 128
                  "
                />

                <circle
                  class="tour-dot"
                  cx="90"
                  cy="45"
                  r="7"
                />

                <path
                  class="tour-flag-new"
                  d="
                    M188 128
                    V91

                    M188 92
                    C202 84 211 97 225 89
                    V108
                    C211 116 202 103 188 111
                  "
                />

              </svg>

            </div>


            <span class="home-card-arrow">
              →
            </span>

          </button>



          <!-- 지역 선택 -->

          <button
            id="region-button"
            class="
              home-card
              home-region-card
              home-card-redesign
            "
            type="button"
          >

            <div class="home-card-copy">

              <span class="home-card-number">
                02
              </span>

              <h2>
                지역 선택
              </h2>

              <p>
                지도에서 원하는 구를 골라 플레이
              </p>

            </div>


            <div
              class="home-redesign-visual region"
              aria-hidden="true"
            >

              <svg viewBox="0 0 130 120">

                <path
                  class="region-map-new"
                  d="
                    M25 79
                    L20 52
                    L38 34
                    L59 30
                    L70 18
                    L94 29
                    L109 48
                    L104 69
                    L115 84
                    L95 100
                    L73 95
                    L60 106
                    L43 93
                    Z
                  "
                />

                <path
                  class="region-pin-new"
                  d="
                    M68 40
                    C55 40 48 49 48 60
                    C48 76 68 94 68 94
                    C68 94 88 76 88 60
                    C88 49 81 40 68 40
                    Z
                  "
                />

                <circle
                  cx="68"
                  cy="59"
                  r="6"
                  fill="white"
                />

              </svg>

            </div>


            <span class="home-card-arrow">
              →
            </span>

          </button>



          <!-- 랭킹 -->

          <button
            id="ranking-button"
            class="
              home-card
              home-ranking-card
              home-card-redesign
            "
            type="button"
          >

            <div class="home-card-copy">

              <span class="home-card-number">
                03
              </span>

              <h2>
                랭킹
              </h2>

              <p>
                내 기록과 최고 기록 확인
              </p>

            </div>


            <div
              class="home-redesign-visual ranking"
              aria-hidden="true"
            >

              <svg viewBox="0 0 130 120">

                <path
                  class="ranking-trophy-new"
                  d="
                    M46 26
                    H84
                    V49
                    C84 66 76 76 65 76
                    C54 76 46 66 46 49
                    Z

                    M46 34
                    H29
                    C29 53 36 61 49 61

                    M84 34
                    H101
                    C101 53 94 61 81 61

                    M65 76
                    V93

                    M49 101
                    H81

                    M56 93
                    H74
                  "
                />

                <path
                  class="ranking-star-new"
                  d="
                    M65 39
                    L69 47
                    L78 48
                    L71 54
                    L73 63
                    L65 59
                    L57 63
                    L59 54
                    L52 48
                    L61 47
                    Z
                  "
                />

              </svg>

            </div>


            <span class="home-card-arrow">
              →
            </span>

          </button>

        </section>



        <!-- =========================================
             SETTINGS
        ========================================== -->

        <button
          id="settings-button"
          class="home-settings-button"
          type="button"
        >

          <span class="home-settings-icon">
            ⚙
          </span>

          <strong>
            설정
          </strong>

          <span class="home-settings-divider"></span>

          <span class="home-settings-description">
            사운드 및 게임 환경 설정
          </span>

          <span class="home-settings-arrow">
            →
          </span>

        </button>



        <!-- =========================================
             INSTAGRAM
        ========================================== -->

        <footer class="home-contact">

          <div class="home-contact-title">
            <span></span>
            문의 및 소통
            <span></span>
          </div>


          <a
            class="home-instagram-link"
            href="${instagramUrl}"
            target="_blank"
            rel="noopener noreferrer"
          >

            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
            >

              <rect
                x="3"
                y="3"
                width="18"
                height="18"
                rx="5"
              />

              <circle
                cx="12"
                cy="12"
                r="4"
              />

              <circle
                cx="17.3"
                cy="6.8"
                r="1"
                class="instagram-dot"
              />

            </svg>

            <span>
              Insta
            </span>

          </a>

        </footer>

      </div>

    </main>
  `;



  /* =========================================
     BUTTON EVENTS
  ========================================== */


  document
    .querySelector("#region-button")
    ?.addEventListener(
      "click",
      () => {

        gameMode =
          "region";

        showSeoulMapScreen();

      }
    );



  document
    .querySelector("#seoul-tour-button")
    ?.addEventListener(
      "click",
      async () => {

        gameMode =
          "tour";


        tourGuIndex =
          0;

        tourResults =
          [];

        tourStartTime =
          null;

        tourKeyStrokeCount =
          0;

        tourAccuracyCorrect =
          0;

        tourAccuracyWrong =
          0;

        tourCompletedDongCount =
          0;


        const allDongLists =
          await Promise.all(
            seoulGuOrder.map(
              guName =>
                getDongsForGu(
                  guName
                )
            )
          );


        tourTotalDongCount =
          allDongLists.reduce(
            (
              total,
              dongs
            ) =>
              total +
              dongs.length,
            0
          );


        showTourCountdownScreen();

      }
    );



  document
    .querySelector("#ranking-button")
    ?.addEventListener(
      "click",
      () => {
        showRankingScreen();
      }
    );



  document
    .querySelector("#settings-button")
    ?.addEventListener(
      "click",
      () => {
        showSettingsScreen();
      }
    );



  document
    .querySelector("#login-button")
    ?.addEventListener(
      "click",
      () => {

        if (user) {
          showProfileScreen();
        } else {
          showAuthScreen();
        }

      }
    );
}

async function isNicknameTaken(
  nickname,
  currentUserId = null
) {
  let query =
    supabase
      .from("profiles")
      .select("id")
      .eq("nickname", nickname);


  if (currentUserId) {
    query =
      query.neq(
        "id",
        currentUserId
      );
  }


  const { data, error } =
    await query.limit(1);


  if (error) {
    console.error(
      "닉네임 중복 확인 실패:",
      error
    );

    return null;
  }


  return data.length > 0;
}

function showAuthScreen() {
  app.innerHTML = `
    <main class="auth-screen">

      <header class="auth-topbar">
        <button
          id="auth-back-button"
          class="auth-back-button"
        >
          ← 홈으로
        </button>

        <div class="auth-brand">
          SEOUL TYPING
        </div>
      </header>


      <section class="auth-layout">

        <div class="auth-intro">

          <p class="auth-kicker">
            ✦ SEOUL TYPING ACCOUNT ✦
          </p>

          <h1>
            기록을 저장하고<br>
            랭킹에 도전하세요.
          </h1>

          <p class="auth-description">
            로그인하면 개인 기록을 저장하고<br>
            서울 종주 및 지역별 랭킹에 참여할 수 있어요.
          </p>

        </div>


        <section class="auth-card">

          <div class="auth-card-header">

            <span class="auth-card-badge">
              LOGIN
            </span>

            <h2>
              로그인
            </h2>

            <p>
              계정 정보를 입력해주세요.
            </p>

          </div>


          <form
            id="auth-form"
            class="auth-form"
          >

            <label class="auth-field">

              <span>
                이메일
              </span>

              <input
                id="auth-email"
                type="email"
                placeholder="example@email.com"
                autocomplete="email"
                required
              />

            </label>


            <label class="auth-field">

              <span>
                비밀번호
              </span>

              <input
                id="auth-password"
                type="password"
                placeholder="비밀번호를 입력하세요"
                autocomplete="current-password"
                required
              />

            </label>


            <button
              type="submit"
              class="auth-submit-button"
            >
              <span>
                로그인
              </span>

              <span>
                →
              </span>
            </button>

          </form>


          <div class="auth-divider">
            <span></span>
            <p>또는</p>
            <span></span>
          </div>


          <div class="auth-switch">

            <span>
              아직 계정이 없나요?
            </span>

            <button
              id="signup-button"
              type="button"
            >
              회원가입
            </button>

          </div>

        </section>

      </section>

    </main>
  `;


  document
    .querySelector("#auth-back-button")
    .addEventListener("click", () => {
      showHomeScreen();
    });


  document
  .querySelector("#auth-form")
  .addEventListener("submit", async event => {
    event.preventDefault();

    const email =
      document.querySelector("#auth-email").value.trim();

    const password =
      document.querySelector("#auth-password").value;


    const { data, error } =
      await supabase.auth.signInWithPassword({
        email,
        password
      });


   if (error) {
  console.error(
    "로그인 오류:",
    error
  );

  const message =
    (
      error.message ||
      ""
    ).toLowerCase();


  /*
    이메일 인증을 아직 안 한 경우
  */
  if (
    message.includes(
      "email not confirmed"
    )
  ) {
    alert(
      "이메일 인증이 완료되지 않았습니다.\n" +
      "가입할 때 받은 인증 메일을 확인해주세요."
    );

    return;
  }


  /*
    이메일 형식이 잘못된 경우
  */
  if (
    message.includes(
      "invalid email"
    )
  ) {
    alert(
      "이메일 주소를 다시 확인해주세요."
    );

    return;
  }


  /*
    가입되지 않은 이메일 /
    비밀번호 불일치

    Supabase에서 두 경우를
    동일한 로그인 실패로 처리할 수 있음
  */
  if (
    message.includes(
      "invalid login credentials"
    )
  ) {
    alert(
      "가입되지 않은 이메일이거나\n" +
      "비밀번호가 일치하지 않습니다."
    );

    return;
  }


  /*
    그 외 예상하지 못한 오류
  */
  alert(
    "로그인 중 오류가 발생했습니다.\n" +
    "잠시 후 다시 시도해주세요."
  );

  return;
}


    console.log("로그인 성공:", data);

    alert("로그인되었습니다.");

    showHomeScreen();
  });


 document
  .querySelector("#signup-button")
  .addEventListener("click", () => {
    showSignupScreen();
  });
}

 async function showProfileScreen() {
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    showAuthScreen();
    return;
  }

  const currentNickname =
    user.user_metadata?.nickname || "";

  const currentRegion =
    user.user_metadata?.region || "";


  app.innerHTML = `
    <main class="auth-screen">

      <header class="auth-topbar">

        <button
          id="profile-back-button"
          class="auth-back-button"
        >
          ← 설정으로
        </button>

        <div class="auth-brand">
          SEOUL TYPING
        </div>

      </header>


      <section class="auth-layout">

        <div class="auth-intro">

          <p class="auth-kicker">
            ✦ EDIT PROFILE ✦
          </p>

          <h1>
            나만의 프로필을<br>
            설정해보세요.
          </h1>

          <p class="auth-description">
            닉네임과 대표 지역을<br>
            언제든지 변경할 수 있어요.
          </p>

        </div>


        <section class="auth-card profile-edit-card">

          <div class="auth-card-header">

            <span class="auth-card-badge">
              PROFILE
            </span>

            <h2>
              내 정보 수정
            </h2>

            <p>
              랭킹에 표시될 정보를 수정하세요.
            </p>

          </div>


          <form
            id="profile-edit-form"
            class="auth-form"
          >

            <!-- 닉네임 -->

            <label class="auth-field">

              <span>
                닉네임
              </span>

              <input
                id="profile-nickname"
                type="text"
                value="${currentNickname}"
                maxlength="8"
                required
              />

              <small class="auth-field-hint">
                최대 8자
              </small>

            </label>


            <!-- 대표 지역 -->

            <label class="auth-field">

              <span>
                대표 지역
              </span>

              <select
                id="profile-region-1"
                class="auth-select"
                required
              >

                <option value="">
                  시·도를 선택하세요
                </option>

                ${getSortedKoreaRegions()
  .map(
                    region => `
                      <option value="${region}">
                        ${region}
                      </option>
                    `
                  )
                  .join("")}

              </select>

            </label>


            <label
              id="profile-region-2-field"
              class="auth-field region-sub-field is-hidden"
            >

              <span>
                시·군·구
              </span>

              <select
                id="profile-region-2"
                class="auth-select"
              >
                <option value="">
                  시·군·구를 선택하세요
                </option>
              </select>

            </label>


            <label
              id="profile-region-3-field"
              class="auth-field region-sub-field is-hidden"
            >

              <span>
                구
              </span>

              <select
                id="profile-region-3"
                class="auth-select"
              >
                <option value="">
                  구를 선택하세요
                </option>
              </select>

            </label>


            <button
              type="submit"
              class="auth-submit-button"
            >
              <span>
                변경사항 저장
              </span>

              <span>
                →
              </span>
            </button>

          </form>


          <button
            id="logout-button"
            class="profile-secondary-button"
          >
            로그아웃
          </button>


          <button
            id="delete-account-button"
            class="profile-delete-button"
          >
            계정 탈퇴
          </button>

        </section>

      </section>

    </main>
  `;


  /* =========================
     뒤로가기
  ========================== */

  document
    .querySelector("#profile-back-button")
    .addEventListener("click", () => {
      showSettingsScreen();
    });


  /* =========================
     지역 선택
  ========================== */

  const region1 =
    document.querySelector("#profile-region-1");

  const region2 =
    document.querySelector("#profile-region-2");

  const region3 =
    document.querySelector("#profile-region-3");


  const region2Field =
    document.querySelector("#profile-region-2-field");

  const region3Field =
    document.querySelector("#profile-region-3-field");


  region1.addEventListener("change", () => {

    const selectedRegion =
      region1.value;


    region2.innerHTML = `
      <option value="">
        시·군·구를 선택하세요
      </option>
    `;

    region3.innerHTML = `
      <option value="">
        구를 선택하세요
      </option>
    `;


    region2Field.classList.add("is-hidden");
    region3Field.classList.add("is-hidden");


    if (!selectedRegion) {
      return;
    }


    const cities =
      koreaRegions[selectedRegion];

    const cityNames =
  Object.keys(cities).sort((a, b) =>
    a.localeCompare(b, "ko")
  );


    if (cityNames.length === 0) {
      return;
    }


    region2.innerHTML +=
      cityNames
        .map(
          city => `
            <option value="${city}">
              ${city}
            </option>
          `
        )
        .join("");


    region2Field.classList.remove("is-hidden");
  });


  region2.addEventListener("change", () => {

    const selectedRegion =
      region1.value;

    const selectedCity =
      region2.value;


    region3.innerHTML = `
      <option value="">
        구를 선택하세요
      </option>
    `;


    region3Field.classList.add("is-hidden");


    if (!selectedRegion || !selectedCity) {
      return;
    }


    const districts =
  koreaRegions[selectedRegion][selectedCity];


if (
  !districts ||
  districts.length === 0
) {
  return;
}


const sortedDistricts =
  [...districts].sort(
    (a, b) =>
      a.localeCompare(
        b,
        "ko"
      )
  );


region3.innerHTML +=
  sortedDistricts
    .map(
      district => `
        <option value="${district}">
          ${district}
        </option>
      `
    )
    .join("");


region3Field.classList.remove(
  "is-hidden"
);
      
  });


  /* =========================
     저장 버튼
     실제 Supabase 저장은 다음 단계
  ========================== */

  document
  .querySelector("#profile-edit-form")
  .addEventListener("submit", async event => {

    event.preventDefault();


    const nickname =
      document
        .querySelector("#profile-nickname")
        .value
        .trim();


    /* 닉네임 검사 */

    if (nickname.length < 2 || nickname.length > 8) {
      alert("닉네임은 2자 이상 8자 이하로 입력해주세요.");
      return;
    }

    const nicknameTaken =
  await isNicknameTaken(
    nickname,
    user.id
  );


if (nicknameTaken === null) {
  alert(
    "닉네임 중복 확인 중 오류가 발생했습니다."
  );

  return;
}


if (nicknameTaken) {
  alert(
    "이미 사용 중인 닉네임입니다."
  );

  return;
}


    /* 지역 조합 */

    const selectedRegionParts = [
      region1.value,
      region2.value,
      region3.value
    ].filter(Boolean);


    /*
      지역을 새로 선택한 경우에는 새 지역 사용.
      아무것도 선택하지 않았다면 기존 지역 유지.
    */

    const finalRegion =
      selectedRegionParts.length > 0
        ? selectedRegionParts.join(" ")
        : currentRegion;


    /* =========================================
   1. profiles 테이블 수정
========================================= */

const {
  error: profileUpdateError
} =
  await supabase
    .from("profiles")
    .update({
      nickname: nickname,
      region: finalRegion
    })
    .eq(
      "id",
      user.id
    );


if (profileUpdateError) {

  console.error(
    "profiles 수정 오류:",
    profileUpdateError
  );


  /* 닉네임 UNIQUE 충돌 */
  if (
    profileUpdateError.code === "23505"
  ) {

    alert(
      "이미 사용 중인 닉네임입니다."
    );

    return;
  }


  alert(
    "프로필 수정에 실패했습니다.\n" +
    profileUpdateError.message
  );

  return;
}


/* =========================================
   2. Auth metadata도 동일하게 수정
========================================= */

const {
  data,
  error: authUpdateError
} =
  await supabase.auth.updateUser({

    data: {
      nickname: nickname,
      region: finalRegion
    }

  });


if (authUpdateError) {

  console.error(
    "사용자 정보 수정 오류:",
    authUpdateError
  );

  alert(
    "사용자 정보 수정에 실패했습니다.\n" +
    authUpdateError.message
  );

  return;
}


console.log(
  "프로필 수정 성공:",
  data
);


alert(
  "프로필이 수정되었습니다."
);


showSettingsScreen();

  });


  /* =========================
     로그아웃
  ========================== */

  document
    .querySelector("#logout-button")
    .addEventListener("click", async () => {

      const { error } =
        await supabase.auth.signOut();

      if (error) {
        alert("로그아웃에 실패했습니다.");
        return;
      }


      alert("로그아웃되었습니다.");

      showHomeScreen();
    });


  /* =========================
     계정 탈퇴
  ========================== */

 document
  .querySelector("#delete-account-button")
  .addEventListener("click", async () => {

    const firstConfirm =
      confirm(
        "정말 계정을 탈퇴하시겠습니까?\n\n" +
        "회원 정보와 모든 게임 기록이 삭제됩니다."
      );

    if (!firstConfirm) {
      return;
    }


    const secondConfirm =
      confirm(
        "삭제된 계정과 기록은 복구할 수 없습니다.\n" +
        "계속하시겠습니까?"
      );

    if (!secondConfirm) {
      return;
    }


    try {

      const {
        data,
        error
      } =
        await supabase.functions.invoke(
          "delete-account",
          {
            body: {}
          }
        );


      if (error) {

        console.error(
          "계정 탈퇴 실패:",
          error
        );

        alert(
          "계정 탈퇴 중 오류가 발생했습니다."
        );

        return;
      }


      if (
        !data ||
        data.success !== true
      ) {

        console.error(
          "계정 탈퇴 응답 오류:",
          data
        );

        alert(
          data?.error ||
          "계정 탈퇴에 실패했습니다."
        );

        return;
      }


      /*
        서버에서 계정이 이미 삭제됐으므로
        로컬 세션만 정리
      */

      await supabase.auth.signOut();


      alert(
        "계정이 탈퇴되었습니다."
      );


      showHomeScreen();

    } catch (error) {

      console.error(
        "계정 탈퇴 처리 오류:",
        error
      );

      alert(
        "계정 탈퇴 중 오류가 발생했습니다."
      );

    }

  });
}


function showSignupScreen() {
  app.innerHTML = `
    <main class="auth-screen">

      <header class="auth-topbar">
        <button
          id="signup-back-button"
          class="auth-back-button"
        >
          ← 로그인
        </button>

        <div class="auth-brand">
          SEOUL TYPING
        </div>
      </header>


      <section class="auth-layout signup-layout">

        <div class="auth-intro">

          <p class="auth-kicker">
            ✦ CREATE YOUR ACCOUNT ✦
          </p>

          <h1>
            나만의 기록을<br>
            만들어보세요.
          </h1>

          <p class="auth-description">
            닉네임과 대표 지역을 설정하고<br>
            서울 타이핑 랭킹에 참여하세요.
          </p>

        </div>


        <section class="auth-card signup-card">

          <div class="auth-card-header">

            <span class="auth-card-badge">
              SIGN UP
            </span>

            <h2>
              회원가입
            </h2>

            <p>
              기본 정보를 입력해주세요.
            </p>

          </div>


          <form
            id="signup-form"
            class="auth-form"
          >

            <label class="auth-field">
              <span>이메일</span>

              <input
                id="signup-email"
                type="email"
                placeholder="example@email.com"
                autocomplete="email"
                required
              />
            </label>


            <label class="auth-field">
              <span>비밀번호</span>

              <input
                id="signup-password"
                type="password"
                placeholder="비밀번호를 입력하세요"
                autocomplete="new-password"
                required
              />
            </label>


            <label class="auth-field">
              <span>비밀번호 확인</span>

              <input
                id="signup-password-confirm"
                type="password"
                placeholder="비밀번호를 다시 입력하세요"
                autocomplete="new-password"
                required
              />
            </label>


            <label class="auth-field">
              <span>닉네임</span>

              <input
                id="signup-nickname"
                type="text"
                placeholder="랭킹에 표시할 닉네임"
                maxlength="8"
                required
              />

              <small class="auth-field-hint">
  최대 8자
</small>


            </label>


            <label class="auth-field">
  <span>대표 지역</span>

  <select
    id="signup-region-1"
    class="auth-select"
    required
  >
    <option value="">
      시·도를 선택하세요
    </option>

    ${getSortedKoreaRegions()
  .map(
        region => `
          <option value="${region}">
            ${region}
          </option>
        `
      )
      .join("")}

  </select>
</label>


<label
  id="signup-region-2-field"
  class="auth-field region-sub-field is-hidden"
>
  <span>시·군·구</span>

  <select
    id="signup-region-2"
    class="auth-select"
  >
    <option value="">
      시·군·구를 선택하세요
    </option>
  </select>
</label>


<label
  id="signup-region-3-field"
  class="auth-field region-sub-field is-hidden"
>
  <span>구</span>

  <select
    id="signup-region-3"
    class="auth-select"
  >
    <option value="">
      구를 선택하세요
    </option>
  </select>
</label>

            <button
              type="submit"
              class="auth-submit-button"
            >
              <span>
                회원가입
              </span>

              <span>
                →
              </span>
            </button>

          </form>


          <div class="auth-switch signup-switch">

            <span>
              이미 계정이 있나요?
            </span>

            <button
              id="login-switch-button"
              type="button"
            >
              로그인
            </button>

          </div>

        </section>

      </section>

    </main>
  `;

  const region1 =
  document.querySelector("#signup-region-1");

const region2 =
  document.querySelector("#signup-region-2");

const region3 =
  document.querySelector("#signup-region-3");


const region2Field =
  document.querySelector("#signup-region-2-field");

const region3Field =
  document.querySelector("#signup-region-3-field");


region1.addEventListener("change", () => {

  const selectedRegion =
    region1.value;

  region2.innerHTML = `
    <option value="">
      시·군·구를 선택하세요
    </option>
  `;

  region3.innerHTML = `
    <option value="">
      구를 선택하세요
    </option>
  `;


  region2Field.classList.add("is-hidden");
  region3Field.classList.add("is-hidden");


  if (!selectedRegion) {
    return;
  }


  const cities =
    koreaRegions[selectedRegion];


  const cityNames =
  Object.keys(cities).sort((a, b) =>
    a.localeCompare(b, "ko")
  );


  /* 해외 / 기타처럼 하위 지역이 없는 경우 */

  if (cityNames.length === 0) {
    return;
  }


  region2.innerHTML +=
    cityNames
      .map(
        city => `
          <option value="${city}">
            ${city}
          </option>
        `
      )
      .join("");


  region2Field.classList.remove("is-hidden");
});


region2.addEventListener("change", () => {

  const selectedRegion =
    region1.value;

  const selectedCity =
    region2.value;


  region3.innerHTML = `
    <option value="">
      구를 선택하세요
    </option>
  `;


  region3Field.classList.add("is-hidden");


  if (!selectedRegion || !selectedCity) {
    return;
  }


 const districts =
  koreaRegions[selectedRegion][selectedCity];


if (
  !districts ||
  districts.length === 0
) {
  return;
}


const sortedDistricts =
  [...districts].sort(
    (a, b) =>
      a.localeCompare(
        b,
        "ko"
      )
  );


  region3.innerHTML +=
    sortedDistricts
  .map(
        district => `
          <option value="${district}">
            ${district}
          </option>
        `
      )
      .join("");


  region3Field.classList.remove("is-hidden");
});


  document
    .querySelector("#signup-back-button")
    .addEventListener("click", () => {
      showAuthScreen();
    });


  document
    .querySelector("#login-switch-button")
    .addEventListener("click", () => {
      showAuthScreen();
    });


  document
  .querySelector("#signup-form")
  .addEventListener("submit", async event => {
    event.preventDefault();

    const email =
      document.querySelector("#signup-email").value.trim();

    const password =
      document.querySelector("#signup-password").value;

    const passwordConfirm =
      document.querySelector("#signup-password-confirm").value;

    const nickname =
      document.querySelector("#signup-nickname").value.trim();

    const region1 =
      document.querySelector("#signup-region-1").value;

    const region2 =
      document.querySelector("#signup-region-2").value;

    const region3 =
      document.querySelector("#signup-region-3").value;


    /* 비밀번호 확인 */

    if (password !== passwordConfirm) {
      alert("비밀번호가 일치하지 않습니다.");
      return;
    }


   /* 닉네임 길이 */

if (nickname.length < 2 || nickname.length > 8) {
  alert("닉네임은 2자 이상 8자 이하로 입력해주세요.");
  return;
}


/* 닉네임 중복 확인 */

const nicknameTaken =
  await isNicknameTaken(
    nickname
  );

if (nicknameTaken === null) {
  alert("닉네임 중복 확인 중 오류가 발생했습니다.");
  return;
}

if (nicknameTaken) {
  alert("이미 사용 중인 닉네임입니다.");
  return;
}


/* 대표 지역 조합 */

    const regionParts = [
      region1,
      region2,
      region3
    ].filter(Boolean);

    const finalRegion =
      regionParts.join(" ");


    if (!finalRegion) {
      alert("대표 지역을 선택해주세요.");
      return;
    }


    /* 회원가입 */

    const { data, error } =
      await supabase.auth.signUp({
        email,
        password,

        options: {
          emailRedirectTo: "https://seoul-typing.vercel.app",

          data: {
            nickname,
            region: finalRegion,
          }
        }
      });


    if (error) {
      console.error(error);

      alert(
        "회원가입 중 오류가 발생했습니다.\n" +
        error.message
      );

      return;
    }


    alert(
      "회원가입 요청이 완료되었습니다.\n" +
      "이메일로 전송된 인증 링크를 확인해주세요."
    );


    showAuthScreen();
  });
}

/* =========================================================
   MY RECORDS
========================================================= */

function formatMyRecordTime(
  seconds
) {

  const value =
    Math.max(
      0,
      Number(
        seconds || 0
      )
    );


  if (value < 60) {
    return `${value.toFixed(1)}초`;
  }


  const minutes =
    Math.floor(
      value / 60
    );


  const remain =
    Math.floor(
      value % 60
    );


  return `${minutes}분 ${remain}초`;
}


function formatMyRecordDate(
  dateString
) {

  if (!dateString) {
    return "-";
  }


  const date =
    new Date(
      dateString
    );


  return date.toLocaleDateString(
    "ko-KR",
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  );

}


function getMyRecordModeLabel(
  record
) {

  if (
    record.mode === "tour"
  ) {
    return "서울 종주";
  }


  if (
    record.mode === "region"
  ) {

    return (
      record.target_region ||
      "지역 선택"
    );

  }


  return (
    record.target_region ||
    "플레이"
  );

}


/* =========================================================
   전체 기록 모달
========================================================= */

function openMyAllRecordsModal(
  records
) {

  const existing =
    document.querySelector(
      "#my-all-records-modal"
    );


  if (existing) {
    existing.remove();
  }


  const modal =
    document.createElement(
      "div"
    );


  modal.id =
    "my-all-records-modal";

  modal.className =
    "my-all-records-modal";


  modal.innerHTML = `
    <div
      class="my-all-records-backdrop"
      id="my-all-records-backdrop"
    ></div>

    <section
      class="my-all-records-card"
    >

      <header
        class="my-all-records-header"
      >

        <div>
          <span>
            ALL RECORDS
          </span>

          <h2>
            전체 기록
          </h2>

          <p>
            지금까지 저장된 모든 플레이 기록입니다.
          </p>
        </div>

        <button
          id="my-all-records-close"
          type="button"
          aria-label="닫기"
        >
          ×
        </button>

      </header>


      <div
        class="my-all-records-list"
      >

        ${
          records
            .map(
              (
                record,
                index
              ) => `

                <div
                  class="my-all-record-row"
                >

                  <div
                    class="my-all-record-index"
                  >
                    ${
                      String(
                        index + 1
                      ).padStart(
                        2,
                        "0"
                      )
                    }
                  </div>


                  <div
                    class="my-all-record-name"
                  >

                    <span
                      class="
                        my-record-mode
                        ${
                          record.mode ===
                          "tour"
                            ? "tour"
                            : "region"
                        }
                      "
                    >
                      ${
                        record.mode ===
                        "tour"
                          ? "종주"
                          : "지역"
                      }
                    </span>

                    <div>
                      <strong>
                        ${
                          getMyRecordModeLabel(
                            record
                          )
                        }
                      </strong>

                      <span>
                        ${
                          formatMyRecordDate(
                            record.created_at
                          )
                        }
                      </span>
                    </div>

                  </div>


                  <div
                    class="my-all-record-values"
                  >

                    <div>
                      <span>타수</span>
                      <strong>
                        ${
                          Math.round(
                            Number(
                              record.typing_speed ||
                              0
                            )
                          )
                        }
                      </strong>
                    </div>

                    <div>
                      <span>정확도</span>
                      <strong>
                        ${
                          Math.round(
                            Number(
                              record.accuracy ||
                              0
                            )
                          )
                        }%
                      </strong>
                    </div>

                    <div>
                      <span>시간</span>
                      <strong>
                        ${
                          formatMyRecordTime(
                            record.time_seconds
                          )
                        }
                      </strong>
                    </div>

                  </div>

                </div>

              `
            )
            .join("")
        }

      </div>

    </section>
  `;


  document.body.appendChild(
    modal
  );


  const closeModal =
    () => {

      modal.remove();

    };


  document
    .querySelector(
      "#my-all-records-close"
    )
    ?.addEventListener(
      "click",
      closeModal
    );


  document
    .querySelector(
      "#my-all-records-backdrop"
    )
    ?.addEventListener(
      "click",
      closeModal
    );

}


/* =========================================================
   MY RECORDS SCREEN
========================================================= */

async function showMyRecordsScreen() {

  const {
    data: { user },
    error: userError
  } =
    await supabase.auth.getUser();


  if (
    userError ||
    !user
  ) {

    showAuthScreen();
    return;

  }


  /* =======================================================
     DB
  ======================================================= */

  const {
    data,
    error
  } =
    await supabase
      .from(
        "game_records"
      )
      .select(`
        mode,
        target_region,
        time_seconds,
        typing_speed,
        accuracy,
        created_at
      `)
      .eq(
        "user_id",
        user.id
      )
      .order(
        "created_at",
        {
          ascending: false
        }
      );


  if (error) {

    console.error(
      "내 기록 조회 실패:",
      error
    );


    alert(
      "기록을 불러오지 못했습니다."
    );


    return;

  }


  const records =
    data || [];


  /* =======================================================
     BASIC STATISTICS
  ======================================================= */

  const totalPlayCount =
    records.length;


  const bestSpeed =
    records.length
      ? Math.max(
          ...records.map(
            record =>
              Number(
                record.typing_speed ||
                0
              )
          )
        )
      : 0;


  const averageSpeed =
    records.length
      ? records.reduce(
          (
            sum,
            record
          ) =>
            sum +
            Number(
              record.typing_speed ||
              0
            ),
          0
        ) /
        records.length
      : 0;


  const averageAccuracy =
    records.length
      ? records.reduce(
          (
            sum,
            record
          ) =>
            sum +
            Number(
              record.accuracy ||
              0
            ),
          0
        ) /
        records.length
      : 0;


  /* =======================================================
     TOUR
  ======================================================= */

  const tourRecords =
    records.filter(
      record =>
        record.mode ===
        "tour"
    );


  const tourCount =
    tourRecords.length;


  const bestTourSpeed =
    tourRecords.length
      ? Math.max(
          ...tourRecords.map(
            record =>
              Number(
                record.typing_speed ||
                0
              )
          )
        )
      : 0;


  const bestTourTime =
    tourRecords.length
      ? Math.min(
          ...tourRecords.map(
            record =>
              Number(
                record.time_seconds ||
                Infinity
              )
          )
        )
      : 0;


  const bestTourAccuracy =
    tourRecords.length
      ? Math.max(
          ...tourRecords.map(
            record =>
              Number(
                record.accuracy ||
                0
              )
          )
        )
      : 0;


  /* =======================================================
     REGION
  ======================================================= */

  const regionRecords =
    records.filter(
      record =>
        record.mode ===
        "region"
    );


  const playedRegionCount =
    new Set(
      regionRecords
        .map(
          record =>
            record.target_region
        )
        .filter(
          Boolean
        )
    ).size;


  const regionBestMap =
    new Map();


  regionRecords.forEach(
    record => {

      const region =
        record.target_region;


      if (!region) {
        return;
      }


      const current =
        regionBestMap.get(
          region
        );


      if (
        !current ||
        Number(
          record.typing_speed ||
          0
        ) >
        Number(
          current.typing_speed ||
          0
        )
      ) {

        regionBestMap.set(
          region,
          record
        );

      }

    }
  );


  const regionBestRecords =
    Array.from(
      regionBestMap.entries()
    )
      .map(
        (
          [
            region,
            record
          ]
        ) => ({
          region,
          ...record
        })
      )
      .sort(
        (
          a,
          b
        ) =>
          Number(
            b.typing_speed ||
            0
          ) -
          Number(
            a.typing_speed ||
            0
          )
      );


  const recentRecords =
    records.slice(
      0,
      8
    );


  const nickname =
    user.user_metadata
      ?.nickname ||
    "플레이어";


  /* =======================================================
     HTML
  ======================================================= */

  app.innerHTML = `
    <main
      class="my-records-screen"
    >

      <button
        id="my-records-back-button"
        class="settings-back-button"
        type="button"
      >
        <span>←</span>
        <kbd>Esc</kbd>
        <span>눌러 돌아가기</span>
      </button>


      <section
        class="my-records-content"
      >


        <header
          class="my-records-header"
        >

          <div
            class="my-records-icon"
          >
            ◷
          </div>

          <p
            class="my-records-eyebrow"
          >
            MY RECORDS
          </p>

          <h1>
            내 기록
          </h1>

          <p>
            ${nickname}님의 플레이 기록을 한눈에 확인하세요.
          </p>

        </header>


        ${
          records.length
            ? `

              <!-- =============================
                   BEST SPEED
              ============================== -->

              <section
                class="my-records-hero"
              >

                <span>
                  최고 타수
                </span>

                <strong>
                  ${
                    Math.round(
                      bestSpeed
                    )
                  }
                  <small>타</small>
                </strong>

                <p>
                  지금까지 기록한 가장 빠른 타수입니다.
                </p>

              </section>


              <!-- =============================
                   GENERAL STATS
              ============================== -->

              <section
                class="my-records-stats"
              >

                <div
                  class="my-record-stat"
                >
                  <span>
                    총 플레이
                  </span>

                  <strong>
                    ${totalPlayCount}
                    <small>회</small>
                  </strong>
                </div>


                <div
                  class="my-record-stat"
                >
                  <span>
                    평균 타수
                  </span>

                  <strong>
                    ${
                      Math.round(
                        averageSpeed
                      )
                    }
                    <small>타</small>
                  </strong>
                </div>


                <div
                  class="my-record-stat"
                >
                  <span>
                    평균 정확도
                  </span>

                  <strong>
                    ${
                      Math.round(
                        averageAccuracy
                      )
                    }
                    <small>%</small>
                  </strong>
                </div>


                <div
                  class="my-record-stat"
                >
                  <span>
                    서울 종주
                  </span>

                  <strong>
                    ${tourCount}
                    <small>회</small>
                  </strong>
                </div>


                <div
                  class="my-record-stat"
                >
                  <span>
                    플레이 지역
                  </span>

                  <strong>
                    ${playedRegionCount}
                    <small>개 구</small>
                  </strong>
                </div>

              </section>


              ${
                tourRecords.length
                  ? `

                    <!-- =========================
                         TOUR BEST
                    ========================== -->

                    <section
                      class="
                        my-records-card
                        my-tour-best-card
                      "
                    >

                      <div
                        class="my-records-section-title"
                      >

                        <div>

                          <span
                            class="my-records-section-icon"
                          >
                            ◎
                          </span>

                          <div>
                            <strong>
                              서울 종주 최고 기록
                            </strong>

                            <p>
                              지금까지의 서울 종주 최고 기록입니다.
                            </p>
                          </div>

                        </div>

                        <span
                          class="my-records-count"
                        >
                          ${tourCount} TOUR
                        </span>

                      </div>


                      <div
                        class="my-tour-best-grid"
                      >

                        <div>
                          <span>
                            최고 타수
                          </span>

                          <strong>
                            ${
                              Math.round(
                                bestTourSpeed
                              )
                            }
                            <small>타</small>
                          </strong>
                        </div>


                        <div>
                          <span>
                            최단 시간
                          </span>

                          <strong>
                            ${
                              formatMyRecordTime(
                                bestTourTime
                              )
                            }
                          </strong>
                        </div>


                        <div>
                          <span>
                            최고 정확도
                          </span>

                          <strong>
                            ${
                              Math.round(
                                bestTourAccuracy
                              )
                            }%
                          </strong>
                        </div>

                      </div>

                    </section>

                  `
                  : ""
              }


              <!-- =============================
                   RECENT
              ============================== -->

              <section
                class="my-records-card"
              >

                <div
                  class="my-records-section-title"
                >

                  <div>

                    <span
                      class="my-records-section-icon"
                    >
                      ◴
                    </span>

                    <div>
                      <strong>
                        최근 플레이
                      </strong>

                      <p>
                        가장 최근 플레이 기록입니다.
                      </p>
                    </div>

                  </div>


                  <span
                    class="my-records-count"
                  >
                    ${totalPlayCount} PLAY
                  </span>

                </div>


                <div
                  class="my-records-list"
                >

                  ${
                    recentRecords
                      .map(
                        record => `

                          <div
                            class="my-record-row"
                          >

                            <div
                              class="my-record-main"
                            >

                              <span
                                class="
                                  my-record-mode
                                  ${
                                    record.mode ===
                                    "tour"
                                      ? "tour"
                                      : "region"
                                  }
                                "
                              >
                                ${
                                  record.mode ===
                                  "tour"
                                    ? "종주"
                                    : "지역"
                                }
                              </span>


                              <div>

                                <strong>
                                  ${
                                    getMyRecordModeLabel(
                                      record
                                    )
                                  }
                                </strong>

                                <span>
                                  ${
                                    formatMyRecordDate(
                                      record.created_at
                                    )
                                  }
                                </span>

                              </div>

                            </div>


                            <div
                              class="my-record-numbers"
                            >

                              <div>
                                <span>
                                  타수
                                </span>

                                <strong>
                                  ${
                                    Math.round(
                                      Number(
                                        record.typing_speed ||
                                        0
                                      )
                                    )
                                  }
                                </strong>
                              </div>


                              <div>
                                <span>
                                  정확도
                                </span>

                                <strong>
                                  ${
                                    Math.round(
                                      Number(
                                        record.accuracy ||
                                        0
                                      )
                                    )
                                  }%
                                </strong>
                              </div>


                              <div>
                                <span>
                                  시간
                                </span>

                                <strong>
                                  ${
                                    formatMyRecordTime(
                                      record.time_seconds
                                    )
                                  }
                                </strong>
                              </div>

                            </div>

                          </div>

                        `
                      )
                      .join("")
                  }

                </div>


                ${
                  records.length > 8
                    ? `

                      <button
                        id="my-all-records-button"
                        class="my-all-records-button"
                        type="button"
                      >
                        전체 기록 보기
                        <span>→</span>
                      </button>

                    `
                    : ""
                }

              </section>


              <!-- =============================
                   REGION BEST
              ============================== -->

              <section
                class="my-records-card"
              >

                <div
                  class="my-records-section-title"
                >

                  <div>

                    <span
                      class="my-records-section-icon"
                    >
                      ↗
                    </span>

                    <div>
                      <strong>
                        지역별 최고 기록
                      </strong>

                      <p>
                        지역을 누르면 해당 구 랭킹으로 이동합니다.
                      </p>
                    </div>

                  </div>


                  <span
                    class="my-records-count"
                  >
                    ${playedRegionCount} REGION
                  </span>

                </div>


                ${
                  regionBestRecords.length
                    ? `

                      <div
                        class="my-region-record-grid"
                      >

                        ${
                          regionBestRecords
                            .map(
                              (
                                record,
                                index
                              ) => `

                                <button
                                  class="
                                    my-region-record
                                    my-region-record-button
                                  "
                                  data-gu="${record.region}"
                                  type="button"
                                >

                                  <div
                                    class="my-region-rank"
                                  >
                                    ${
                                      String(
                                        index + 1
                                      ).padStart(
                                        2,
                                        "0"
                                      )
                                    }
                                  </div>


                                  <div
                                    class="my-region-name"
                                  >

                                    <strong>
                                      ${record.region}
                                    </strong>

                                    <span>
                                      랭킹 보기 →
                                    </span>

                                  </div>


                                  <div
                                    class="my-region-speed"
                                  >

                                    <strong>
                                      ${
                                        Math.round(
                                          Number(
                                            record.typing_speed ||
                                            0
                                          )
                                        )
                                      }
                                    </strong>

                                    <span>
                                      타
                                    </span>

                                  </div>

                                </button>

                              `
                            )
                            .join("")
                        }

                      </div>

                    `
                    : `

                      <div
                        class="my-records-empty-small"
                      >
                        아직 지역 선택 플레이 기록이 없습니다.
                      </div>

                    `
                }

              </section>

            `
            : `

              <!-- =============================
                   EMPTY
              ============================== -->

              <section
                class="my-records-empty"
              >

                <div
                  class="my-records-empty-icon"
                >
                  ◷
                </div>

                <strong>
                  아직 저장된 기록이 없어요.
                </strong>

                <p>
                  서울 종주 또는 지역 선택을 플레이하면<br>
                  이곳에서 기록을 확인할 수 있습니다.
                </p>

                <button
                  id="my-records-play-button"
                  type="button"
                >
                  첫 기록 만들기
                  <span>→</span>
                </button>

              </section>

            `
        }

      </section>

    </main>
  `;


  /* =======================================================
     BACK
  ======================================================= */

  document
    .querySelector(
      "#my-records-back-button"
    )
    ?.addEventListener(
      "click",
      () => {

        showSettingsScreen();

      }
    );


  /* =======================================================
     EMPTY → HOME
  ======================================================= */

  document
    .querySelector(
      "#my-records-play-button"
    )
    ?.addEventListener(
      "click",
      () => {

        showHomeScreen();

      }
    );


  /* =======================================================
     ALL RECORDS
  ======================================================= */

  document
    .querySelector(
      "#my-all-records-button"
    )
    ?.addEventListener(
      "click",
      () => {

        openMyAllRecordsModal(
          records
        );

      }
    );


  /* =======================================================
     REGION → RANKING
  ======================================================= */

  document
    .querySelectorAll(
      ".my-region-record-button"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          async () => {

            const guName =
              button.dataset.gu;


            if (!guName) {
              return;
            }


            await showRankingScreen();


            await Promise.all([

              drawRankingSeoulMap(
                guName
              ),

              showGuRankingPanel(
                guName
              )

            ]);

          }
        );

      }
    );

}

async function showSettingsScreen() {

const {
  data: { user }
} = await supabase.auth.getUser();

const nickname =
  user?.user_metadata?.nickname || "";

const region =
  user?.user_metadata?.region || "";


  app.innerHTML = `
    <main class="settings-screen">

      <button
        id="settings-back-button"
        class="settings-back-button"
      >
        <span>←</span>
        <kbd>Esc</kbd>
        <span>눌러 돌아가기</span>
      </button>


      <section class="settings-content">

        <div class="settings-icon">
          ⚙
        </div>

        <p class="settings-eyebrow">
          SETTINGS
        </p>

        <h1>
          설정
        </h1>

        <p class="settings-description">
          프로필과 게임 환경을 관리하세요.
        </p>


        <!-- =========================
             프로필
        ========================== -->

        <section class="settings-card profile-settings-card">

          <div class="settings-card-title">
            <div>
              <span class="settings-card-icon">
                👤
              </span>

              <div>
                <strong>내 프로필</strong>

                <p>
                  랭킹에 표시되는 정보를 관리합니다.
                </p>
              </div>
            </div>
          </div>


          ${
  user
    ? `
      <div class="profile-login-placeholder">


        <strong>
          ${nickname || "닉네임 없음"}
        </strong>

        <p>
          랭킹에 표시되는 내 프로필 정보입니다.
        </p>

        <div class="profile-preview">

          <div>
            <span>닉네임</span>
            <strong>${nickname || "닉네임 없음"}</strong>
          </div>

          <div>
            <span>대표 지역</span>
            <strong>${region || "지역 없음"}</strong>
          </div>

        </div>

        <div class="settings-profile-actions">

  <button
    id="settings-records-button"
    class="settings-records-button"
    type="button"
  >
    <span>내 기록</span>
    <span>→</span>
  </button>

  <button
    id="settings-profile-button"
    class="profile-secondary-button"
    type="button"
  >
    내 정보 수정
  </button>

</div>

      </div>
    `
    : `
      <div class="profile-login-placeholder">

        <div class="profile-placeholder-icon">
          👤
        </div>

        <strong>
          로그인 후 프로필을 설정할 수 있어요
        </strong>

        <p>
          로그인하면 닉네임과 대표 지역을<br>
          확인하고 관리할 수 있습니다.
        </p>

        <button
          id="settings-login-button"
          class="profile-secondary-button"
        >
          로그인
        </button>

      </div>
    `
}

        </section>


        <!-- =========================
             게임 설정
        ========================== -->

        <section class="settings-card">

          <div class="settings-card-title">

            <div>
              <span class="settings-card-icon">
                ⌨
              </span>

              <div>
                <strong>게임 설정</strong>

                <p>
                  플레이 화면을 원하는 방식으로 조정하세요.
                </p>
              </div>
            </div>

          </div>


          <!-- 사운드 -->

          <div class="settings-row">

            <div class="settings-row-info">
              <strong>사운드</strong>

              <span>
                게임 효과음을 켜거나 끕니다.
              </span>
            </div>

            <button
              id="sound-setting-button"
              class="settings-toggle
                ${gameSettings.sound
                  ? "is-on"
                  : ""
                }"
            >

              <span class="settings-toggle-dot"></span>

              <strong id="sound-setting-text">
                ${
                  gameSettings.sound
                    ? "ON"
                    : "OFF"
                }
              </strong>

            </button>

          </div>


          <!-- 지도 크기 -->

          <div class="settings-row">

            <div class="settings-row-info">
              <strong>지도 크기</strong>

              <span>
                플레이 중 표시되는 지도의 크기입니다.
              </span>
            </div>


            <div
              class="settings-segment"
              data-setting="mapSize"
            >

              <button
                data-value="small"
                class="${
                  gameSettings.mapSize === "small"
                    ? "active"
                    : ""
                }"
              >
                작게
              </button>

              <button
                data-value="medium"
                class="${
                  gameSettings.mapSize === "medium"
                    ? "active"
                    : ""
                }"
              >
                기본
              </button>

              <button
                data-value="large"
                class="${
                  gameSettings.mapSize === "large"
                    ? "active"
                    : ""
                }"
              >
                크게
              </button>

            </div>

          </div>


          <!-- 지역명 글자 크기 -->

          <div class="settings-row">

            <div class="settings-row-info">
              <strong>지역명 글자 크기</strong>

              <span>
                지도에 표시되는 지역명의 크기입니다.
              </span>
            </div>


            <div
              class="settings-segment"
              data-setting="labelSize"
            >

              <button
                data-value="small"
                class="${
                  gameSettings.labelSize === "small"
                    ? "active"
                    : ""
                }"
              >
                작게
              </button>

              <button
                data-value="medium"
                class="${
                  gameSettings.labelSize === "medium"
                    ? "active"
                    : ""
                }"
              >
                기본
              </button>

              <button
                data-value="large"
                class="${
                  gameSettings.labelSize === "large"
                    ? "active"
                    : ""
                }"
              >
                크게
              </button>

            </div>

          </div>


        <!-- 타이핑 목적지 글자 크기 -->

<div class="settings-row">

  <div class="settings-row-info">

    <strong>
      타이핑 글자 크기
    </strong>

    <span>
      현재·이전·다음 지역명의 크기입니다.
    </span>

  </div>


  <div
    class="settings-segment"
    data-setting="targetTextSize"
  >

    <button
      data-value="small"
      class="${
        gameSettings.targetTextSize ===
        "small"
          ? "active"
          : ""
      }"
    >
      작게
    </button>


    <button
      data-value="medium"
      class="${
        gameSettings.targetTextSize ===
        "medium"
          ? "active"
          : ""
      }"
    >
      기본
    </button>


    <button
      data-value="large"
      class="${
        gameSettings.targetTextSize ===
        "large"
          ? "active"
          : ""
      }"
    >
      크게
    </button>

  </div>

</div>

        </section>

        <p class="settings-save-note">
          변경한 설정은 자동으로 저장됩니다.
        </p>

      </section>

    </main>
  `;

  if (user) {

  document
    .querySelector(
      "#settings-profile-button"
    )
    ?.addEventListener(
      "click",
      () => {
        showProfileScreen();
      }
    );


  document
    .querySelector(
      "#settings-records-button"
    )
    ?.addEventListener(
      "click",
      () => {
        showMyRecordsScreen();
      }
    );

} else {

  document
    .querySelector(
      "#settings-login-button"
    )
    ?.addEventListener(
      "click",
      () => {
        showAuthScreen();
      }
    );

}


  /* 뒤로가기 */

  document
    .querySelector("#settings-back-button")
    .addEventListener("click", () => {
      showHomeScreen();
    });


  /* 사운드 */

  const soundButton =
    document.querySelector(
      "#sound-setting-button"
    );

  const soundText =
    document.querySelector(
      "#sound-setting-text"
    );


  soundButton.addEventListener(
    "click",
    () => {

      gameSettings.sound =
        !gameSettings.sound;

      soundButton.classList.toggle(
        "is-on",
        gameSettings.sound
      );

      soundText.textContent =
        gameSettings.sound
          ? "ON"
          : "OFF";

      saveGameSettings(
        gameSettings
      );
    }
  );


  /* 지도 크기 / 글자 크기 */

  document
    .querySelectorAll(
      ".settings-segment"
    )
    .forEach(segment => {

      segment
        .querySelectorAll("button")
        .forEach(button => {

          button.addEventListener(
            "click",
            () => {

              const settingName =
                segment.dataset.setting;

              const value =
                button.dataset.value;


              gameSettings[
                settingName
              ] = value;


              segment
                .querySelectorAll(
                  "button"
                )
                .forEach(item => {
                  item.classList.remove(
                    "active"
                  );
                });


              button.classList.add(
                "active"
              );


              saveGameSettings(
                gameSettings
              );

            }
          );

        });

    });
}

async function showTourCountdownScreen() {

   currentGameSessionId = null;
  currentGameSessionPromise = null;

  const firstGuName = seoulGuOrder[0];

  const firstGuDongs =
    await getDongsForGu(firstGuName);

  const firstDongName =
    firstGuDongs[0] || "-";

  let countdown = 3;

  app.innerHTML = `
    <main class="tour-countdown-screen">

      <button
        id="tour-countdown-back-button"
        class="gu-start-esc-button"
      >
        <span class="gu-start-esc-arrow">←</span>
        <kbd>Esc</kbd>
        <span>눌러 돌아가기</span>
      </button>


      <section class="tour-countdown-content">

        <div class="gu-start-pin">
          📍
        </div>

        <p class="gu-start-eyebrow">
          SEOUL TOUR
        </p>

        <h1 class="tour-countdown-title">
          서울 종주
        </h1>

        <p class="tour-countdown-description">
          서울 25개 구를 처음부터 끝까지<br>
          순서대로 타이핑해보자!
        </p>


        <div class="tour-countdown-info">

          <div class="tour-countdown-info-item">
            <span>첫 시작 구</span>
            <strong>${firstGuName}</strong>
          </div>

          <div class="tour-countdown-divider"></div>

          <div class="tour-countdown-info-item">
            <span>첫 시작 지역</span>
            <strong>${firstDongName}</strong>
          </div>

        </div>


        <div
          id="tour-countdown-number"
          class="tour-countdown-number"
        >
          3
        </div>

        <p class="tour-countdown-ready">
          잠시 후 서울 종주가 시작됩니다.
        </p>

      </section>

    </main>
  `;


  const number =
    document.querySelector(
      "#tour-countdown-number"
    );

    playSoundEffect("countdown");


  const interval = setInterval(() => {
    countdown--;

    if (countdown > 0) {
      number.textContent = countdown;

      playSoundEffect("countdown");

      number.classList.remove(
        "tour-countdown-pop"
      );

      void number.offsetWidth;

      number.classList.add(
        "tour-countdown-pop"
      );

      return;
    }


    clearInterval(interval);

    showTypingScreen(
      seoulGuOrder[tourGuIndex]
    );

  }, 1000);


  document
    .querySelector(
      "#tour-countdown-back-button"
    )
    .addEventListener("click", () => {

      clearInterval(interval);

      gameMode = null;

      tourGuIndex = 0;
      tourResults = [];

      tourStartTime = null;
      tourKeyStrokeCount = 0;

      tourAccuracyCorrect = 0;
      tourAccuracyWrong = 0;

      tourCompletedDongCount = 0;

      showHomeScreen();
    });
}

function getShortRegion(region = "") {
  const regionMap = {
    "서울특별시": "서울",
    "부산광역시": "부산",
    "대구광역시": "대구",
    "인천광역시": "인천",
    "광주광역시": "광주",
    "대전광역시": "대전",
    "울산광역시": "울산",
    "세종특별자치시": "세종",
    "경기도": "경기",
    "강원특별자치도": "강원",
    "충청북도": "충북",
    "충청남도": "충남",
    "전북특별자치도": "전북",
    "전라남도": "전남",
    "경상북도": "경북",
    "경상남도": "경남",
    "제주특별자치도": "제주"
  };

  const parts =
    region
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  if (parts.length === 0) {
    return "기타";
  }

  parts[0] =
    regionMap[parts[0]] ||
    parts[0];

  return parts.join(" · ");
}

async function showRankingScreen() {

  app.innerHTML = `
    <main class="ranking-screen ranking-v2">


      <!-- =========================================
           좌측 상단 뒤로가기
      ========================================== -->

      <button
        id="ranking-back-button"
        class="
          settings-back-button
          ranking-page-back-button
        "
        type="button"
      >
        <span>
          ←
        </span>

        <kbd>
          Esc
        </kbd>

        <span>
          눌러 돌아가기
        </span>
      </button>



      <!-- =========================================
           우측 상단
           누적 플레이 랭킹만 유지
      ========================================== -->

      <div class="ranking-page-top-actions">

        <button
          id="playtime-ranking-button"
          class="ranking-playtime-button"
          type="button"
        >
          ◷ 누적 플레이 랭킹
        </button>

      </div>



      <!-- =========================================
           랭킹 본문
      ========================================== -->

      <div class="ranking-dashboard">


        <!-- =========================
             왼쪽 : 서울 종주 랭킹
        ========================== -->

        <aside
          id="tour-ranking-panel"
          class="ranking-side-panel"
        >

          <div class="ranking-side-loading">
            기록을 불러오는 중...
          </div>

        </aside>



        <!-- =========================
             가운데 : 서울 지도
        ========================== -->

        <section class="ranking-center-panel">

          <div class="ranking-map-heading">

  <h1>
    서울
    <strong>
      25개 구
    </strong>
    전체 랭킹
  </h1>

  <span>
    지도를 클릭하여 구별 랭킹을 확인하세요.
  </span>

</div>


          <div
            id="ranking-seoul-map"
          ></div>



          <!-- =========================
               지도 색상 기준
          ========================== -->

          <div class="ranking-map-legend">

            <div class="ranking-map-legend-title">

              지도 색상 기준

              <span>
                (내 최고 타수)
              </span>

            </div>


            <div
              class="ranking-map-legend-gradient"
            ></div>


            <div class="ranking-map-legend-labels">

              <span>
                기록 없음
              </span>

              <span>
                200타
              </span>

              <span>
                400타
              </span>

              <span>
                500타
              </span>

              <span>
                600타
              </span>

              <span>
                700타+
              </span>

            </div>

          </div>

        </section>



        <!-- =========================
             오른쪽 : 지역 랭킹
        ========================== -->

        <aside
          id="gu-ranking-panel"
          class="ranking-side-panel"
        >

          <div class="ranking-detail-empty">

            <div class="ranking-detail-empty-icon">
              ↖
            </div>

            <strong>
              지역을 선택하세요
            </strong>

            <p>
              서울 지도에서 원하는 구를 클릭하면<br>
              랭킹이 여기에 표시됩니다.
            </p>

          </div>

        </aside>

      </div>



      <p class="ranking-bottom-note">
        ※ 기록은 최고 타수 기준으로 집계됩니다.
      </p>

    </main>



    <!-- =========================================
         공통 랭킹 모달
    ========================================== -->

    <div
      id="ranking-modal"
      class="ranking-modal is-hidden"
    >

      <div
        class="ranking-modal-backdrop"
      ></div>


      <section class="ranking-modal-card">

        <button
          id="ranking-modal-close"
          class="ranking-modal-close"
          type="button"
        >
          ×
        </button>


        <div
          id="ranking-modal-content"
        ></div>

      </section>

    </div>
  `;



  /* =========================================
     누적 플레이 랭킹
  ========================================== */

  document
    .querySelector(
      "#playtime-ranking-button"
    )
    ?.addEventListener(
      "click",
      () => {

        showPlaytimeRankingModal();

      }
    );



  /* =========================================
     뒤로가기
  ========================================== */

  document
    .querySelector(
      "#ranking-back-button"
    )
    ?.addEventListener(
      "click",
      () => {

        showHomeScreen();

      }
    );



  /* =========================================
     랭킹 모달 닫기
  ========================================== */

  document
    .querySelector(
      "#ranking-modal-close"
    )
    ?.addEventListener(
      "click",
      () => {

        closeRankingModal();

      }
    );


  document
    .querySelector(
      ".ranking-modal-backdrop"
    )
    ?.addEventListener(
      "click",
      () => {

        closeRankingModal();

      }
    );



  /* =========================================
     랭킹 데이터
  ========================================== */

  await Promise.all([

    showTourRankingPanel(),

    drawRankingSeoulMap()

  ]);

}


/* =========================================================
   랭킹 데이터 불러오기
========================================================= */

async function getRankingRecords(
  mode,
  targetRegion = null
) {

  let query =
    supabase
      .from("game_records")
      .select(`
        user_id,
        created_at,
        time_seconds,
        typing_speed,
        accuracy,
        mistakes,
        profiles (
          nickname,
          region
        )
      `)
      .eq("mode", mode);


  if (targetRegion) {
    query =
      query.eq(
        "target_region",
        targetRegion
      );
  }


  const { data, error } =
    await query;


  if (error) {

    console.error(
      "랭킹 데이터 조회 실패:",
      error
    );

    return [];
  }


  return (data || []).map(record => ({

    playerId:
      record.user_id,

    nickname:
      record.profiles?.nickname ||
      "알 수 없음",

    region:
      getShortRegion(
        record.profiles?.region
      ),

    speed:
      Number(
        record.typing_speed || 0
      ),

    accuracy:
      Number(
        record.accuracy || 0
      ),

    time:
      Number(
        record.time_seconds || 0
      ),

    mistakes:
      Number(
        record.mistakes || 0
      ),

    date:
      record.created_at

  }));
}


/* =========================================================
   한 사람당 최고 기록 1개
========================================================= */

function getBestRecordPerPlayer(records) {

  const bestByPlayer = {};


  records.forEach(record => {

    const current =
      bestByPlayer[
        record.playerId
      ];


    if (!current) {

      bestByPlayer[
        record.playerId
      ] = record;

      return;
    }


    /* 1. 타수가 더 높으면 교체 */

    if (
      record.speed >
      current.speed
    ) {

      bestByPlayer[
        record.playerId
      ] = record;

      return;
    }


    /* 2. 타수가 같으면
          시간이 더 짧은 기록 채택 */

    if (
      record.speed ===
        current.speed &&
      record.time <
        current.time
    ) {

      bestByPlayer[
        record.playerId
      ] = record;

      return;
    }


    /* 3. 타수와 시간까지 같으면
          정확도가 더 높은 기록 채택 */

    if (
      record.speed ===
        current.speed &&
      record.time ===
        current.time &&
      record.accuracy >
        current.accuracy
    ) {

      bestByPlayer[
        record.playerId
      ] = record;

    }

  });


  return Object
    .values(bestByPlayer)
    .sort((a, b) => {

      /* 1. 최고 타수 */

      if (
        b.speed !==
        a.speed
      ) {
        return (
          b.speed -
          a.speed
        );
      }


      /* 2. 같은 타수면
            더 빠른 시간 */

      if (
        a.time !==
        b.time
      ) {
        return (
          a.time -
          b.time
        );
      }


      /* 3. 시간도 같으면
            정확도 */

      return (
        b.accuracy -
        a.accuracy
      );

    });
}

/* =========================================================
   누적 플레이 시간 랭킹
========================================================= */

async function getPlaytimeRanking() {

  const { data, error } =
    await supabase
      .from("game_records")
      .select(`
        user_id,
        time_seconds,
        profiles (
          nickname,
          region
        )
      `);

  if (error) {
    console.error(
      "누적 플레이 시간 조회 실패:",
      error
    );

    return [];
  }


  const players = {};


  (data || []).forEach(record => {

    if (!record.user_id) {
      return;
    }

    if (!players[record.user_id]) {

      players[record.user_id] = {
        playerId:
          record.user_id,

        nickname:
          record.profiles?.nickname ||
          "알 수 없음",

        region:
          getShortRegion(
            record.profiles?.region
          ),

        totalSeconds: 0,

        playCount: 0
      };
    }


    players[
      record.user_id
    ].totalSeconds +=
      Number(
        record.time_seconds || 0
      );


    players[
      record.user_id
    ].playCount += 1;

  });


  return Object
  .values(players)
  .sort((a, b) => {

    /* 누적 시간이 긴 사람 우선 */

    if (
      b.totalSeconds !==
      a.totalSeconds
    ) {
      return (
        b.totalSeconds -
        a.totalSeconds
      );
    }


    /* 시간이 완전히 같다면
       플레이 횟수가 많은 사람 우선 */

    if (
      b.playCount !==
      a.playCount
    ) {
      return (
        b.playCount -
        a.playCount
      );
    }


    /* 그것도 같으면 닉네임순 */

    return (
      a.nickname || ""
    ).localeCompare(
      b.nickname || "",
      "ko"
    );

  });
}

function formatPlaytime(
  totalSeconds
) {

  const seconds =
    Math.floor(
      totalSeconds
    );


  const hours =
    Math.floor(
      seconds / 3600
    );


  const minutes =
    Math.floor(
      (seconds % 3600) / 60
    );


  const remainingSeconds =
    seconds % 60;


  if (hours > 0) {
    return `${hours}시간 ${minutes}분`;
  }


  if (minutes > 0) {
    return `${minutes}분 ${remainingSeconds}초`;
  }


  return `${remainingSeconds}초`;
}

async function showPlaytimeRankingModal() {

  const ranking =
    await getPlaytimeRanking();


  const {
    data: { user }
  } =
    await supabase.auth.getUser();


  const modal =
    document.querySelector(
      "#ranking-modal"
    );

  const content =
    document.querySelector(
      "#ranking-modal-content"
    );


  if (!modal || !content) {
    return;
  }


  const myRecord =
    user
      ? ranking.find(
          record =>
            record.playerId === user.id
        )
      : null;


  const myRank =
    myRecord
      ? ranking.findIndex(
          record =>
            record.playerId === user.id
        ) + 1
      : null;


  function createPlaytimeRow(
    record,
    rank
  ) {

    const isMe =
      user &&
      record.playerId === user.id;


    let rankClass = "";

    if (rank === 1) {
      rankClass = "rank-gold";
    }

    if (rank === 2) {
      rankClass = "rank-silver";
    }

    if (rank === 3) {
      rankClass = "rank-bronze";
    }


    return `
      <button
        type="button"
        class="
          playtime-ranking-row
          playtime-user-detail-button
          ${isMe ? "is-me" : ""}
        "
        data-player-id="${record.playerId}"
        data-rank="${rank}"
      >

        <div
          class="
            ranking-v2-position
            ${rankClass}
          "
        >
          ${rank}
        </div>


        <div class="playtime-ranking-user">

          <div class="playtime-ranking-name">
            ${record.nickname}

            ${
              isMe
                ? `
                  <span class="ranking-me-label">
                    나
                  </span>
                `
                : ""
            }
          </div>

          <div class="playtime-ranking-region">
            ${record.region || "지역 미설정"}
          </div>

        </div>


        <div class="playtime-ranking-time">

          <strong>
            ${formatPlaytime(
              record.totalSeconds
            )}
          </strong>

          <span>
            총 ${record.playCount.toLocaleString()}회 플레이
          </span>

        </div>

      </button>
    `;
  }


  content.innerHTML = `

    <div class="playtime-modal-layout">

      <div class="ranking-modal-header">

        <p>
          TOTAL PLAYTIME
        </p>

        <h2>
          누적 플레이 랭킹
        </h2>

        <span>
          총 ${ranking.length}명의 기록
        </span>

      </div>


      <div class="playtime-ranking-scroll">

        ${
          ranking.length
            ? ranking
                .map(
                  (record, index) =>
                    createPlaytimeRow(
                      record,
                      index + 1
                    )
                )
                .join("")
            : `
              <div class="ranking-side-empty">
                아직 플레이 기록이 없습니다.
              </div>
            `
        }

      </div>


      ${
        user
          ? `
            <div class="playtime-my-area">

              <div class="playtime-my-title">
                내 기록
              </div>

              ${
                myRecord
                  ? createPlaytimeRow(
                      myRecord,
                      myRank
                    )
                  : `
                    <div class="playtime-my-empty">
                      아직 플레이 기록이 없습니다.
                    </div>
                  `
              }

            </div>
          `
          : ""
      }

    </div>
  `;


  content
    .querySelectorAll(
      ".playtime-user-detail-button"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const playerId =
            button.dataset.playerId;

          const rank =
            Number(
              button.dataset.rank
            );


          const player =
            ranking.find(
              item =>
                item.playerId ===
                playerId
            );


          if (!player) {
            return;
          }


          openPlaytimePlayerDetailModal(
            playerId,
            rank,
            player
          );

        }
      );

    });


  modal.classList.remove(
    "is-hidden"
  );
}

async function openPlaytimePlayerDetailModal(
  playerId,
  rank,
  player
) {
  const modal =
    document.querySelector(
      "#ranking-modal"
    );

  const content =
    document.querySelector(
      "#ranking-modal-content"
    );

  if (!modal || !content) return;


  /* 모든 플레이 기록 */

  const {
    data,
    error
  } =
    await supabase
      .from("game_records")
      .select(`
        mode,
        target_region,
        time_seconds,
        typing_speed,
        accuracy,
        created_at
      `)
      .eq(
        "user_id",
        playerId
      )
      .order(
        "created_at",
        {
          ascending: true
        }
      );


  if (error) {

    console.error(
      "플레이 상세정보 조회 실패:",
      error
    );

    return;
  }


  const records =
    data || [];


  /* =============================
     기본 통계
  ============================= */

  const totalPlayCount =
    records.length;


  const totalSeconds =
    records.reduce(
      (sum, record) =>
        sum +
        Number(
          record.time_seconds || 0
        ),
      0
    );


  const averageAccuracy =
    records.length
      ? records.reduce(
          (sum, record) =>
            sum +
            Number(
              record.accuracy || 0
            ),
          0
        ) / records.length
      : 0;


  /* =============================
     플레이 유형별 횟수
  ============================= */

  const regionPlayCount =
    records.filter(
      record =>
        record.mode === "region"
    ).length;


  const tourPlayCount =
    records.filter(
      record =>
        record.mode === "tour"
    ).length;


  /* =============================
     최고 타수
  ============================= */

  const bestSpeed =
    records.length
      ? Math.max(
          ...records.map(
            record =>
              Number(
                record.typing_speed || 0
              )
          )
        )
      : 0;


  /* =============================
     플레이한 서로 다른 구 수
  ============================= */

  const playedGuCount =
    new Set(
      records
        .filter(
          record =>
            record.mode === "region" &&
            record.target_region
        )
        .map(
          record =>
            record.target_region
        )
    ).size;


  const firstPlay =
    records.length
      ? records[0].created_at
      : null;


  const lastPlay =
    records.length
      ? records[
          records.length - 1
        ].created_at
      : null;


  /* 현재 로그인한 사람인지 */

  const {
    data: { user }
  } =
    await supabase.auth.getUser();


  const isMe =
    user &&
    user.id === playerId;


  let rankClass = "";

  if (rank === 1) {
    rankClass = "rank-gold";
  }

  if (rank === 2) {
    rankClass = "rank-silver";
  }

  if (rank === 3) {
    rankClass = "rank-bronze";
  }


  content.innerHTML = `

    <div class="player-detail-modal">

      <div class="player-detail-top">

        <div
          class="
            ranking-v2-position
            ${rankClass}
          "
        >
          ${rank}
        </div>


        <div class="player-detail-identity">

          <div class="player-detail-name">

            ${player.nickname}

            ${
              isMe
                ? `
                  <span class="ranking-me-label">
                    나
                  </span>
                `
                : ""
            }

          </div>


          <div class="player-detail-region">
            ${
              player.region ||
              "지역 미설정"
            }
          </div>

        </div>


        ${
          isMe
            ? `
              <span class="player-detail-my-badge">
                내 기록
              </span>
            `
            : ""
        }

      </div>


      <div class="player-detail-main-stats">

        <div>
          <strong>
            ${formatTotalPlayTime(
              totalSeconds
            )}
          </strong>

          <span>
            누적 플레이 시간
          </span>
        </div>


        <div>
          <strong>
            ${totalPlayCount.toLocaleString()}회
          </strong>

          <span>
            총 플레이
          </span>
        </div>


        <div>
          <strong>
            ${bestSpeed.toLocaleString()}타
          </strong>

          <span>
            최고 타수
          </span>
        </div>

      </div>


      <div class="player-detail-info">

        <div class="player-detail-info-row">
          <span>
            평균 정확도
          </span>

          <strong>
            ${averageAccuracy.toFixed(1)}%
          </strong>
        </div>


        <div class="player-detail-info-row">
          <span>
            지역 플레이
          </span>

          <strong>
            ${regionPlayCount.toLocaleString()}회
          </strong>
        </div>


        <div class="player-detail-info-row">
          <span>
            서울 종주
          </span>

          <strong>
            ${tourPlayCount.toLocaleString()}회
          </strong>
        </div>


        <div class="player-detail-info-row">
          <span>
            플레이한 서울 지역
          </span>

          <strong>
            ${playedGuCount} / 25구
          </strong>
        </div>


        <div class="player-detail-info-row">
          <span>
            처음 플레이
          </span>

          <strong>
            ${formatPlayerDate(
              firstPlay
            )}
          </strong>
        </div>


        <div class="player-detail-info-row">
          <span>
            마지막 플레이
          </span>

          <strong>
            ${formatPlayerDate(
              lastPlay
            )}
          </strong>
        </div>

      </div>

    </div>
  `;


  modal.classList.remove(
    "is-hidden"
  );
}

/* =========================================================
   좌우 공통 랭킹 패널
========================================================= */

async function renderRankingSidePanel({
  panel,
  title,
  icon,
  records,
  emptyMessage,
  modalTitle
}) {

  if (!panel) {
    return;
  }


  const {
    data: { user }
  } =
    await supabase.auth.getUser();


  /*
    같은 사용자가 여러 번 플레이해도
    랭킹에는 최고 기록 하나만 표시
  */

  const rankingRecords =
    getBestRecordPerPlayer(
      records
    );


  /*
    메인 패널에는 최대 5명까지만 표시
  */

  const topFive =
    rankingRecords.slice(0, 5);


  const myRecord =
    user
      ? rankingRecords.find(
          record =>
            record.playerId === user.id
        )
      : null;


  const myRank =
    myRecord
      ? rankingRecords.findIndex(
          record =>
            record.playerId === user.id
        ) + 1
      : null;


  panel.innerHTML = `

    <div class="ranking-side-header">

      <div class="ranking-side-title">

        <span class="ranking-side-icon">
          ${icon}
        </span>

        <h2>
          ${title}
        </h2>

      </div>


      <span class="ranking-total-count">
        총 ${rankingRecords.length}명의 기록
      </span>

    </div>


    <div class="ranking-side-list">

      ${
        topFive.length
          ? topFive
              .map(
                (record, index) =>
                  createRankingRow(
                    record,
                    index + 1,
                    user?.id
                  )
              )
              .join("")
          : `
            <div class="ranking-side-empty">
              ${emptyMessage}
            </div>
          `
      }

    </div>


    ${
      user
        ? createMyRankingCard(
            myRecord,
            myRank
          )
        : `
          <button
            type="button"
            class="
              ranking-login-card
              ranking-login-prompt
            "
          >

            <div class="ranking-login-prompt-text">

              <strong>
                내 기록
              </strong>

              <span>
                로그인하고 내 순위를 확인하세요.
              </span>

            </div>

            <span class="ranking-login-prompt-action">
              로그인 →
            </span>

          </button>
        `
    }


    <button
      type="button"
      class="ranking-view-all-button"
    >
      <span>☷</span>

      <span>
        전체 기록 보기
      </span>

      <span>→</span>
    </button>
  `;


  /*
    랭킹 사용자 클릭
  */

  panel
    .querySelectorAll(
      ".ranking-user-detail-button"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const playerId =
            button.dataset.playerId;


          const rank =
            Number(
              button.dataset.rank
            );


          const record =
            rankingRecords.find(
              item =>
                item.playerId ===
                playerId
            );


          if (!record) {
            return;
          }


          openPlayerDetailModal(
            playerId,
            rank,
            record
          );

        }
      );

    });


  /*
    로그인 안내 카드
  */

  panel
    .querySelector(
      ".ranking-login-prompt"
    )
    ?.addEventListener(
      "click",
      () => {
        showAuthScreen();
      }
    );


  /*
    전체 기록 보기
    ★ 기존 코드에서 빠져 있던 부분
  */

  panel
    .querySelector(
      ".ranking-view-all-button"
    )
    ?.addEventListener(
      "click",
      () => {

        openRankingModal(
          modalTitle,
          rankingRecords,
          user?.id || null
        );

      }
    );
}



/* =========================================================
   랭킹 한 줄
========================================================= */

function formatRankingRegion(
  region = ""
) {

  if (!region) {
    return `
      <span>지역 미설정</span>
    `;
  }


  const parts =
    region
      .split(" · ")
      .map(part => part.trim())
      .filter(Boolean);


  /*
    서울 · 종로구
    → 한 줄

    경기 · 고양시 · 일산서구
    → 경기 · 고양시
       일산서구
  */

  if (parts.length <= 2) {
    return `
      <span>
        ${parts.join(" · ")}
      </span>
    `;
  }


  return `
    <span>
      ${parts
        .slice(0, 2)
        .join(" · ")}
    </span>

    <span>
      ${parts
        .slice(2)
        .join(" · ")}
    </span>
  `;
}

function createRankingRow(
  record,
  rank,
  currentUserId = null
) {

  const isMe =
    currentUserId &&
    record.playerId === currentUserId;


  let rankClass = "";

  if (rank === 1) {
    rankClass = "rank-gold";
  }

  if (rank === 2) {
    rankClass = "rank-silver";
  }

  if (rank === 3) {
    rankClass = "rank-bronze";
  }


  return `
    <button
      type="button"
      class="
        ranking-v2-row
        ranking-user-detail-button
        ${isMe ? "is-me" : ""}
      "
      data-player-id="${record.playerId}"
      data-rank="${rank}"
    >

      <div
        class="
          ranking-v2-position
          ${rankClass}
        "
      >
        ${rank}
      </div>


      <div class="ranking-v2-user">

        <div class="ranking-v2-name">

          ${record.nickname}

          ${
            isMe
              ? `
                <span class="ranking-me-label">
                  나
                </span>
              `
              : ""
          }

        </div>


        <div class="ranking-v2-region">
          ${formatRankingRegion(
            record.region
          )}
        </div>

      </div>


      <div class="ranking-v2-score">

        <strong>
          ${record.speed.toLocaleString()}타
        </strong>

        <span class="ranking-best-time">
          최고 시간 ${record.time.toFixed(1)}초
        </span>

      </div>

    </button>
  `;
}

async function openPlayerDetailModal(
  playerId,
  rank,
  rankingRecord
) {
  const modal =
    document.querySelector("#ranking-modal");

  const content =
    document.querySelector("#ranking-modal-content");

  if (!modal || !content) return;

  // 해당 유저의 모든 플레이 기록
  const { data: allRecords, error } =
    await supabase
      .from("game_records")
      .select("*")
      .eq("user_id", playerId)
      .order("created_at", {
        ascending: true
      });

  if (error) {
    console.error(
      "유저 상세 기록 불러오기 실패:",
      error
    );
    return;
  }

  const records = allRecords || [];

  const totalPlayCount =
    records.length;

  const totalPlaySeconds =
    records.reduce(
      (sum, item) =>
        sum +
        Number(item.time_seconds || 0),
      0
    );

  const averageAccuracy =
    records.length
      ? records.reduce(
          (sum, item) =>
            sum +
            Number(item.accuracy || 0),
          0
        ) / records.length
      : 0;

  const firstPlay =
    records.length
      ? records[0].created_at
      : null;

  const lastPlay =
    records.length
      ? records[
          records.length - 1
        ].created_at
      : null;

  const {
    data: { user }
  } =
    await supabase.auth.getUser();

  const isMe =
    user &&
    user.id === playerId;

  content.innerHTML = `
    <div class="player-detail-modal">

      <div class="player-detail-top">

        <div
          class="
            ranking-v2-position
            ${
              rank === 1
                ? "rank-gold"
                : rank === 2
                ? "rank-silver"
                : rank === 3
                ? "rank-bronze"
                : ""
            }
          "
        >
          ${rank}
        </div>

        <div class="player-detail-identity">

          <div class="player-detail-name">
            ${rankingRecord.nickname}

            ${
              isMe
                ? `
                  <span class="ranking-me-label">
                    나
                  </span>
                `
                : ""
            }
          </div>

          <div class="player-detail-region">
            ${
              rankingRecord.region ||
              "지역 미설정"
            }
          </div>

        </div>

        ${
          isMe
            ? `
              <span class="player-detail-my-badge">
                내 기록
              </span>
            `
            : ""
        }

      </div>


      <div class="player-detail-main-stats">

        <div>
          <strong>
            ${rankingRecord.speed.toLocaleString()}타
          </strong>
          <span>최고 타수</span>
        </div>

        <div>
          <strong>
            ${rankingRecord.time.toFixed(1)}초
          </strong>
          <span>최고 시간</span>
        </div>

        <div>
          <strong>
            ${rankingRecord.accuracy.toFixed(0)}%
          </strong>
          <span>해당 기록 정확도</span>
        </div>

      </div>


      <div class="player-detail-info">

        <div class="player-detail-info-row">
          <span>총 플레이 시간</span>
          <strong>
            ${formatTotalPlayTime(
              totalPlaySeconds
            )}
          </strong>
        </div>

        <div class="player-detail-info-row">
          <span>총 플레이 횟수</span>
          <strong>
            ${totalPlayCount.toLocaleString()}회
          </strong>
        </div>

        <div class="player-detail-info-row">
          <span>평균 정확도</span>
          <strong>
            ${averageAccuracy.toFixed(1)}%
          </strong>
        </div>

        <div class="player-detail-info-row">
          <span>처음 플레이</span>
          <strong>
            ${formatPlayerDate(firstPlay)}
          </strong>
        </div>

        <div class="player-detail-info-row">
          <span>마지막 플레이</span>
          <strong>
            ${formatPlayerDate(lastPlay)}
          </strong>
        </div>

      </div>

    </div>
  `;

  modal.classList.remove(
    "is-hidden"
  );
}


function formatTotalPlayTime(
  totalSeconds
) {
  const seconds =
    Math.floor(totalSeconds);

  const hours =
    Math.floor(seconds / 3600);

  const minutes =
    Math.floor(
      (seconds % 3600) / 60
    );

  const remainSeconds =
    seconds % 60;

  if (hours > 0) {
    return `${hours}시간 ${minutes}분 ${remainSeconds}초`;
  }

  if (minutes > 0) {
    return `${minutes}분 ${remainSeconds}초`;
  }

  return `${remainSeconds}초`;
}


function formatPlayerDate(dateString) {
  if (!dateString) return "-";

  const date =
    new Date(dateString);

  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");

  const hour =
    String(
      date.getHours()
    ).padStart(2, "0");

  const minute =
    String(
      date.getMinutes()
    ).padStart(2, "0");

  return `${year}.${month}.${day} ${hour}:${minute}`;
}

/* =========================================================
   내 기록 카드
========================================================= */

function createMyRankingCard(
  record,
  rank
) {

  if (!record) {
    return `
      <div class="ranking-my-section">

        <div class="ranking-my-section-title">
          내 기록
        </div>

        <div
          class="
            ranking-my-card
            ranking-my-empty-card
          "
        >
          <strong class="ranking-my-empty">
            아직 기록이 없습니다.
          </strong>
        </div>

      </div>
    `;
  }


  let rankClass = "";

  if (rank === 1) {
    rankClass = "rank-gold";
  }

  if (rank === 2) {
    rankClass = "rank-silver";
  }

  if (rank === 3) {
    rankClass = "rank-bronze";
  }


  return `
    <div class="ranking-my-section">

      <div class="ranking-my-section-title">
        내 기록
      </div>


      <button
        type="button"
        class="
          ranking-v2-row
          ranking-user-detail-button
          ranking-my-row
          is-me
        "
        data-player-id="${record.playerId}"
        data-rank="${rank}"
      >

        <div
          class="
            ranking-v2-position
            ${rankClass}
          "
        >
          ${rank}
        </div>


        <div class="ranking-v2-user">

          <div class="ranking-v2-name">

            ${record.nickname}

            <span class="ranking-me-label">
              나
            </span>

          </div>


          <div class="ranking-v2-region">
            ${formatRankingRegion(
              record.region
            )}
          </div>

        </div>


        <div class="ranking-v2-score">

          <strong>
            ${record.speed.toLocaleString()}타
          </strong>

          <span class="ranking-best-time">
            최고 시간 ${record.time.toFixed(1)}초
          </span>

        </div>

      </button>

    </div>
  `;
}


/* =========================================================
   서울 종주 랭킹
========================================================= */

async function showTourRankingPanel() {

  const panel =
    document.querySelector(
      "#tour-ranking-panel"
    );


  if (!panel) return;


  const records =
    await getRankingRecords(
      "tour"
    );


  await renderRankingSidePanel({

    panel,

    title:
      "서울 종주 랭킹",

    icon:
      "🏆",

    records,

    emptyMessage:
      "아직 서울 종주 기록이 없습니다.",

    modalTitle:
      "서울 종주 전체 기록"

  });
}


/* =========================================================
   구별 랭킹
========================================================= */

async function showGuRankingPanel(
  guName
) {

  const panel =
    document.querySelector(
      "#gu-ranking-panel"
    );


  if (!panel) return;


  panel.innerHTML = `
    <div class="ranking-side-loading">
      ${guName} 기록을 불러오는 중...
    </div>
  `;


  const records =
    await getRankingRecords(
      "region",
      guName
    );


  await renderRankingSidePanel({

    panel,

    title:
      `${guName} 전체 랭킹`,

    icon:
      "⌖",

    records,

    emptyMessage:
      `${guName}의 기록이 아직 없습니다.`,

    modalTitle:
      `${guName} 전체 기록`

  });
}


/* =========================================================
   랭킹 서울 지도
========================================================= */

async function drawRankingSeoulMap(
  selectedGu = null
) {
  const container =
    document.querySelector(
      "#ranking-seoul-map"
    );

  if (!container) return;


  /* =========================================
     현재 로그인 사용자 확인
  ========================================= */

  const {
    data: { user }
  } =
    await supabase.auth.getUser();


  /* =========================================
     서울 지도 불러오기
  ========================================= */

  const mapData =
    await d3.json(
      "/maps/seoul-gu.geojson"
    );


  /* =========================================
     현재 사용자의 지역 기록만 불러오기

     로그인하지 않은 경우
     기록은 빈 배열로 처리
  ========================================= */

  let records = [];


  if (user) {

    const {
      data,
      error
    } =
      await supabase
        .from("game_records")
        .select(`
          target_region,
          typing_speed
        `)
        .eq(
          "mode",
          "region"
        )
        .eq(
          "user_id",
          user.id
        );


    if (error) {

      console.error(
        "개인 지도 기록 조회 실패:",
        error
      );

    } else {

      records =
        data || [];

    }

  }


  /* =========================================
     구별 내 최고 타수 계산
  ========================================= */

  const bestSpeedByGu = {};


  records.forEach(record => {

    const gu =
      record.target_region;

    const speed =
      Number(
        record.typing_speed || 0
      );


    if (
      !bestSpeedByGu[gu] ||
      speed > bestSpeedByGu[gu]
    ) {

      bestSpeedByGu[gu] =
        speed;

    }

  });


  /* =========================================
     지도 색상

     선택한 구 = 연한 초록
     기록 없음 = 회색
     내 최고 타수 = 보라색 단계
  ========================================= */

  function getMapColor(
  guName
) {

  /*
    현재 선택한 구
  */
  if (
    guName === selectedGu
  ) {
    return "#BFE8C9";
  }


  const speed =
    bestSpeedByGu[guName] || 0;


  /*
    기록 없음
  */
  if (!speed) {
    return "#E9E9EE";
  }


  /*
    타수별 보라색

    기존 색보다 정말 조금만 연하게 수정.
    전체적인 보라색 느낌은 그대로 유지한다.
  */

  if (speed < 200) {
    return "#F0ECFE";
  }

  if (speed < 400) {
    return "#E0D9FC";
  }

  if (speed < 500) {
    return "#CDC2F8";
  }

  if (speed < 600) {
    return "#B2A0F2";
  }

  if (speed < 700) {
    return "#917AEB";
  }

  return "#7259E2";
}


  /* =========================================
     지도 그리기
  ========================================= */

  container.innerHTML = "";


  const width = 620;
  const height = 560;


  const svg =
    d3
      .select(container)
      .append("svg")
      .attr(
        "viewBox",
        `0 0 ${width} ${height}`
      )
      .attr(
        "width",
        "100%"
      )
      .attr(
        "height",
        "100%"
      );


  const projection =
    d3
      .geoMercator()
      .fitExtent(
        [
          [24, 24],
          [
            width - 24,
            height - 24
          ]
        ],
        mapData
      );


  const path =
    d3.geoPath(
      projection
    );


  /* =========================================
     구 영역
  ========================================= */

  svg
    .selectAll("path")
    .data(mapData.features)
    .join("path")

    .attr(
      "d",
      path
    )

    .attr(
      "fill",
      d =>
        getMapColor(
          d.properties.SIG_KOR_NM
        )
    )

    .attr(
      "stroke",
      "#FFFFFF"
    )

    .attr(
      "stroke-width",
      2
    )

    .style(
      "cursor",
      "pointer"
    )

    .on(
      "mouseenter",
      function () {

        d3
          .select(this)
          .attr(
            "opacity",
            0.78
          );

      }
    )

    .on(
      "mouseleave",
      function () {

        d3
          .select(this)
          .attr(
            "opacity",
            1
          );

      }
    )

    .on(
      "click",
      async function (
        event,
        d
      ) {

        const guName =
          d.properties
            .SIG_KOR_NM;


        await Promise.all([

          drawRankingSeoulMap(
            guName
          ),

          showGuRankingPanel(
            guName
          )

        ]);

      }
    );


  /* =========================================
     구 이름
  ========================================= */

  svg
    .selectAll("text")
    .data(mapData.features)
    .join("text")

    .attr(
      "x",
      d =>
        path.centroid(d)[0]
    )

    .attr(
      "y",
      d =>
        path.centroid(d)[1]
    )

    .attr(
      "text-anchor",
      "middle"
    )

    .attr(
      "dominant-baseline",
      "middle"
    )

    .attr(
      "font-size",
      11
    )

    .attr(
      "font-weight",
      d =>
        d.properties
          .SIG_KOR_NM ===
        selectedGu
          ? 800
          : 600
    )

    .attr(
      "fill",
      d =>
        d.properties
          .SIG_KOR_NM ===
        selectedGu
          ? "#267344"
          : "#434056"
    )

    .style(
      "pointer-events",
      "none"
    )

    .text(
      d =>
        d.properties
          .SIG_KOR_NM
    );
}


/* =========================================================
   전체 기록 보기 모달
========================================================= */

function openRankingModal(
  title,
  records,
  currentUserId
) {

  const modal =
    document.querySelector(
      "#ranking-modal"
    );

  const content =
    document.querySelector(
      "#ranking-modal-content"
    );


  content.innerHTML = `

    <div class="ranking-modal-header">

      <p>
        ALL RECORDS
      </p>

      <h2>
        ${title}
      </h2>

      <span>
        총 ${records.length}명의 기록
      </span>

    </div>


    <div class="ranking-modal-list">

      ${
        records.length
          ? records
              .map(
                (record, index) =>
                  createRankingRow(
                    record,
                    index + 1,
                    currentUserId
                  )
              )
              .join("")
          : `
            <div class="ranking-side-empty">
              아직 기록이 없습니다.
            </div>
          `
      }

    </div>
  `;

  content
    .querySelectorAll(
      ".ranking-user-detail-button"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const playerId =
            button.dataset.playerId;

          const rank =
            Number(
              button.dataset.rank
            );

          const record =
            records.find(
              item =>
                item.playerId ===
                playerId
            );

          if (!record) return;

          openPlayerDetailModal(
            playerId,
            rank,
            record
          );
        }
      );

    });

  modal.classList.remove(
    "is-hidden"
  );
}


function closeRankingModal() {

  document
    .querySelector(
      "#ranking-modal"
    )
    ?.classList.add(
      "is-hidden"
    );

}

function showSeoulMapScreen() {
  app.innerHTML = `
    <main class="region-select-screen">

      <button
        id="home-button"
        class="region-select-back"
      >
        <span class="region-select-back-arrow">←</span>
        <kbd>Esc</kbd>
        <span>눌러 돌아가기</span>
      </button>


      <section class="region-select-content">

        <div class="region-select-icon">
          📍
        </div>

        <p class="region-select-eyebrow">
          REGION SELECT
        </p>

        <h1 class="region-select-title">
          서울 지역 선택
        </h1>

        <p class="region-select-description">
          원하는 구를 선택해<br>
          타자 게임을 시작해보자!
        </p>


        <div class="region-select-map-card">

          <div class="region-select-map-header">
            <div>
              <span class="region-select-map-label">
                SEOUL · 25 GU
              </span>

              <strong>
                플레이할 지역을 선택하세요
              </strong>
            </div>

            <span class="region-select-map-hint">
              지도를 클릭해 선택
            </span>
          </div>


          <div id="seoul-map"></div>

        </div>

      </section>

    </main>
  `;


  document
    .querySelector("#home-button")
    .addEventListener("click", () => {
      showHomeScreen();
    });


  drawSeoulMap();
}

async function drawSeoulMap() {
  const data = await d3.json("/maps/seoul-gu.geojson");

  console.log("서울 자치구 개수:", data.features.length);

  const width = 900;
  const height = 600;

  const svg = d3
  .select("#seoul-map")
  .append("svg")
  .attr("viewBox", `0 0 ${width} ${height}`)
  .attr("width", "100%");

  const projection = d3
    .geoMercator()
    .fitExtent(
      [
        [20, 20],
        [width - 20, height - 20]
      ],
      data
    );

  const path = d3.geoPath(projection);

  svg
    .selectAll("path")
    .data(data.features)
    .join("path")
    .attr("d", path)
    .attr("fill", "#E9E6F4")
.attr("stroke", "#FFFFFF")
.attr("stroke-width", 2)

.on("mouseenter", function () {
  d3.select(this)
    .transition()
    .duration(140)
    .attr("fill", "#B9AEFF");
})

.on("mouseleave", function () {
  d3.select(this)
    .transition()
    .duration(140)
    .attr("fill", "#E9E6F4");
})
.on("click", function (event, d) {
  const selectedGu = d.properties.SIG_KOR_NM;
  showGuStartScreen(selectedGu);
});
    svg
  .selectAll(".gu-label")
  .data(data.features)
  .join("text")
  .attr("class", "gu-label")
  .attr("x", d => path.centroid(d)[0])
  .attr("y", d => path.centroid(d)[1])
  .attr("text-anchor", "middle")
  .attr("dominant-baseline", "middle")
  .attr("font-size", 14)
  .attr("font-weight", 600)
  .attr("fill", "#333")
  .style("pointer-events", "none")
  .text(d => d.properties.SIG_KOR_NM);
}

async function showGuStartScreen(guName) {
  const dongs = await getDongsForGu(guName);

  const firstDong =
    dongs.length > 0
      ? dongs[0]
      : "-";

  const totalDongCount = dongs.length;


  app.innerHTML = `
    <main class="gu-start-screen">

      <div id="gu-start-bg-map"></div>

      <button
        id="back-button"
        class="gu-start-esc-button"
      >
        <span class="gu-start-esc-arrow">←</span>
        <kbd>Esc</kbd>
        <span>눌러 돌아가기</span>
      </button>


      <section class="gu-start-content">

        <div class="gu-start-pin">
          📍
        </div>

        <p class="gu-start-eyebrow">
          REGION SELECTED
        </p>

        <h1 class="gu-start-name">
          ${guName}
        </h1>

        <p class="gu-start-description">
          ${guName}의 동을
          <strong>순서대로</strong>
          타이핑하며<br>
          모든 지역을 클리어해보자!
        </p>


        <section class="gu-start-card">

          <h2 class="gu-start-card-title">
            시작 정보
          </h2>


          <div class="gu-start-info-box">

            <div class="gu-start-info-icon">
              ⚑
            </div>

            <div class="gu-start-info-item">
              <span>시작 지역</span>
              <strong>${firstDong}</strong>
            </div>

            <div class="gu-start-info-divider"></div>

            <div class="gu-start-info-item">
              <span>총 지역 수</span>
              <strong>${totalDongCount}개 동</strong>
            </div>

          </div>


          <div class="gu-start-guide-box">

            <div class="gu-start-guide-icon">
              💡
            </div>

            <div class="gu-start-guide-text">

  <strong>
    게임 안내
  </strong>

  <p>
    • 각 지역 이름을 정확하게 타이핑하세요.
  </p>

  <p>
    • 스페이스나 엔터 없이 지역 이름을 정확히 입력하면
    자동으로 넘어갑니다.
  </p>

  <p>
    • 지도와 지역명 글자 크기는
    설정에서 변경할 수 있습니다.
  </p>

</div>

          </div>


          <button
            id="start-gu-button"
            class="gu-start-button"
          >
            <span class="gu-start-keyboard">
              ⌨
            </span>

            <strong>
              시작하기
            </strong>

            <span class="gu-start-arrow">
              →
            </span>
          </button>

        </section>

      </section>

    </main>
  `;


  drawGuStartBackground(guName);



  document
    .querySelector("#back-button")
    .addEventListener("click", () => {

      showSeoulMapScreen();
    });


  document
    .querySelector("#start-gu-button")
    .addEventListener("click", () => {

      showTypingScreen(guName);
    });
}

async function drawGuStartBackground(guName) {
  const container =
    document.querySelector(
      "#gu-start-bg-map"
    );

  if (!container) return;


  const data =
    await d3.json(
      "/maps/seoul-gu.geojson"
    );


  const width = 1000;
  const height = 700;


  const svg = d3
    .select(container)
    .append("svg")
    .attr(
      "viewBox",
      `0 0 ${width} ${height}`
    );


  const projection = d3
    .geoMercator()
    .fitExtent(
      [
        [20, 20],
        [width - 20, height - 20]
      ],
      data
    );


  const path =
    d3.geoPath(projection);


  svg
    .selectAll("path")
    .data(data.features)
    .join("path")
    .attr("d", path)

    .attr("fill", d =>
      d.properties.SIG_KOR_NM === guName
        ? "#D8D0FF"
        : "#EEEAFB"
    )

    .attr(
      "stroke",
      "#FFFFFF"
    )

    .attr(
      "stroke-width",
      2
    );
}

const CHO_KEYS = [
  "r", "R", "s", "e", "E", "f", "a", "q", "Q",
  "t", "T", "d", "w", "W", "c", "z", "x", "v", "g"
];

const JUNG_KEYS = [
  "k", "o", "i", "O", "j", "p", "u", "P", "h",
  "hk", "ho", "hl", "y", "n", "nj", "np", "nl",
  "b", "m", "ml", "l"
];

const JONG_KEYS = [
  "",
  "r", "R", "rt", "s", "sw", "sg", "e",
  "f", "fr", "fa", "fq", "ft", "fx", "fv", "fg",
  "a", "q", "qt", "t", "T", "d", "w", "c",
  "z", "x", "v", "g"
];

function koreanToKeys(text = "") {
  let result = "";

  /*
    완성형 한글이 되기 전,
    IME 입력창에 잠깐 나타나는
    ㄱ, ㅎ, ㅗ 같은 자모도
    실제 두벌식 키로 변환한다.
  */

  const JAMO_KEYS = {
    /* 자음 */
    "ㄱ": "r",
    "ㄲ": "R",
    "ㄴ": "s",
    "ㄷ": "e",
    "ㄸ": "E",
    "ㄹ": "f",
    "ㅁ": "a",
    "ㅂ": "q",
    "ㅃ": "Q",
    "ㅅ": "t",
    "ㅆ": "T",
    "ㅇ": "d",
    "ㅈ": "w",
    "ㅉ": "W",
    "ㅊ": "c",
    "ㅋ": "z",
    "ㅌ": "x",
    "ㅍ": "v",
    "ㅎ": "g",

    /* 모음 */
    "ㅏ": "k",
    "ㅐ": "o",
    "ㅑ": "i",
    "ㅒ": "O",
    "ㅓ": "j",
    "ㅔ": "p",
    "ㅕ": "u",
    "ㅖ": "P",
    "ㅗ": "h",
    "ㅘ": "hk",
    "ㅙ": "ho",
    "ㅚ": "hl",
    "ㅛ": "y",
    "ㅜ": "n",
    "ㅝ": "nj",
    "ㅞ": "np",
    "ㅟ": "nl",
    "ㅠ": "b",
    "ㅡ": "m",
    "ㅢ": "ml",
    "ㅣ": "l",

    /* 겹받침이 단독 자모로 나타날 경우 */
    "ㄳ": "rt",
    "ㄵ": "sw",
    "ㄶ": "sg",
    "ㄺ": "fr",
    "ㄻ": "fa",
    "ㄼ": "fq",
    "ㄽ": "ft",
    "ㄾ": "fx",
    "ㄿ": "fv",
    "ㅀ": "fg",
    "ㅄ": "qt"
  };


  for (const char of text) {

    /*
      1. 입력 중인 단독 자모
    */

    if (JAMO_KEYS[char]) {
      result += JAMO_KEYS[char];
      continue;
    }


    /*
      2. 완성된 한글 음절
       가 ~ 힣
    */

    const code =
      char.charCodeAt(0);


    if (
      code >= 0xac00 &&
      code <= 0xd7a3
    ) {

      const offset =
        code - 0xac00;

      const cho =
        Math.floor(
          offset / 588
        );

      const jung =
        Math.floor(
          (offset % 588) / 28
        );

      const jong =
        offset % 28;


      result +=
        CHO_KEYS[cho];

      result +=
        JUNG_KEYS[jung];

      result +=
        JONG_KEYS[jong];

      continue;
    }


    /*
      3. 한글 이외 문자
    */

    result += char;
  }


  return result;
}

function normalizeDongName(name) {
  return name
    // 중곡1동 → 중곡동
    // 신정2동 → 신정동
    .replace(/\d+동$/, "동")

    // 을지로1가 → 을지로
    // 충무로2가 → 충무로
    // 회현동1가 → 회현동
    .replace(/\d+가$/, "");
}

/* =========================================================
   구별 타이핑 이동 순서
========================================================= */


/*
  직접 순서를 완전히 지정한 구.

  아래에 없는 구는
  지도상의 실제 위치를 기준으로
  자동 순서를 만든다.
*/

const MANUAL_DONG_ORDERS = {

  "강북구": [
    "우이동",
    "수유동",
    "미아동",
    "번동"
  ],


  "성북구": [
    "성북동",
    "정릉동",
    "길음동",
    "돈암동",
    "동선동",
    "동소문동",
    "삼선동",
    "보문동",
    "안암동",
    "종암동",
    "하월곡동",
    "상월곡동",
    "장위동",
    "석관동"
  ],


  "서대문구": [
    "북가좌동",
    "남가좌동",
    "홍은동",
    "홍제동",
    "연희동",
    "봉원동",
    "현저동",
    "창천동",
    "신촌동",
    "대신동",
    "대현동",
    "북아현동",
    "영천동",
    "옥천동",
    "천연동",
    "냉천동",
    "충정로",
    "합동",
    "미근동"
  ],


  "동대문구": [
    "이문동",
    "회기동",
    "휘경동",
    "청량리동",
    "제기동",
    "전농동",
    "신설동",
    "용두동",
    "답십리동",
    "장안동"
  ],


  "성동구": [
    "상왕십리동",
    "하왕십리동",
    "홍익동",
    "도선동",
    "마장동",
    "행당동",
    "사근동",
    "용답동",
    "금호동",
    "응봉동",
    "송정동",
    "옥수동",
    "성수동"
  ],


  "강서구": [
    "개화동",
    "과해동",
    "방화동",
    "오곡동",
    "오쇠동",
    "공항동",
    "외발산동",
    "마곡동",
    "가양동",
    "내발산동",
    "등촌동",
    "염창동",
    "화곡동"
  ],


  "양천구": [
    "신월동",
    "신정동",
    "목동"
  ],


  "동작구": [
    "신대방동",
    "대방동",
    "노량진동",
    "본동",
    "상도동",
    "흑석동",
    "동작동",
    "사당동"
  ],


  "강동구": [
    "강일동",
    "고덕동",
    "암사동",
    "천호동",
    "명일동",
    "상일동",
    "길동",
    "성내동",
    "둔촌동"
  ],


  "송파구": [
    "풍납동",
    "신천동",
    "잠실동",
    "방이동",
    "삼전동",
    "석촌동",
    "송파동",
    "오금동",
    "가락동",
    "마천동",
    "문정동",
    "거여동",
    "장지동"
  ],


  "서초구": [
    "잠원동",
    "반포동",
    "방배동",
    "서초동",
    "우면동",
    "양재동",
    "염곡동",
    "원지동",
    "신원동",
    "내곡동"
  ],


  "관악구": [
    "신림동",
    "봉천동",
    "남현동"
  ],


  "구로구": [
    "온수동",
    "궁동",
    "항동",
    "오류동",
    "천왕동",
    "개봉동",
    "고척동",
    "신도림동",
    "구로동",
    "가리봉동"
  ]

};



/* =========================================================
   종로구 북쪽 시작 구간

   이 부분까지만 순서를 강제로 지정한다.

   이후 지역은
   왼쪽 → 오른쪽,
   각 열에서는 위 → 아래로 진행.
========================================================= */

const JONGNO_START_ORDER = [

  "구기동",
  "평창동",
  "부암동",
  "신영동",
  "홍지동",
  "청운동"

];



/* =========================================================
   왼쪽 → 오른쪽 자동 이동

   1. 가장 왼쪽 지역부터
   2. 비슷한 X 위치끼리 한 열로 묶음
   3. 한 열 안에서는 위 → 아래
   4. 그 열이 끝나면 오른쪽 열로 이동

   중구 / 용산구 / 종로구 후반에 사용
========================================================= */

function sortDongsLeftToRight(
  positioned
) {

  if (
    positioned.length === 0
  ) {
    return [];
  }


  /*
    핵심:

    centroid(지역 중심점)가 아니라
    실제 지역 도형의 가장 왼쪽 끝인
    leftX를 기준으로 이동한다.

    따라서 만리동처럼 가로로 길어도
    지도 왼쪽 끝에 걸쳐 있으면
    반드시 먼저 플레이된다.
  */


  const COLUMN_TOLERANCE =
    75;


  const remaining =
    [...positioned];


  const result =
    [];


  /*
    왼쪽에서 오른쪽으로
    한 열씩 제거해가는 방식
  */

  while (
    remaining.length > 0
  ) {

    /*
      아직 남아 있는 지역 중
      실제 왼쪽 끝이 가장 왼쪽인 지역
    */

    const minimumLeftX =
      Math.min(
        ...remaining.map(
          item =>
            item.leftX
        )
      );


    /*
      가장 왼쪽 영역과
      충분히 가까운 지역들을
      하나의 세로 열로 취급한다.

      지역의 중심점이 아니라
      도형의 왼쪽 경계를 사용한다.
    */

    const currentColumn =
      remaining.filter(
        item =>
          item.leftX <=
          minimumLeftX +
          COLUMN_TOLERANCE
      );


    /*
      같은 왼쪽 열에서는
      위 → 아래
    */

    currentColumn.sort(
      (a, b) => {

        if (
          Math.abs(
            a.topY -
            b.topY
          ) > 15
        ) {

          return (
            a.topY -
            b.topY
          );

        }


        /*
          높이가 거의 같다면
          더 왼쪽부터
        */

        return (
          a.leftX -
          b.leftX
        );

      }
    );


    /*
      현재 열 전체를 결과에 추가
    */

    result.push(
      ...currentColumn
    );


    /*
      방금 처리한 열을
      remaining에서 제거
    */

    const columnNames =
      new Set(
        currentColumn.map(
          item =>
            item.name
        )
      );


    for (
      let i =
        remaining.length - 1;
      i >= 0;
      i--
    ) {

      if (
        columnNames.has(
          remaining[i].name
        )
      ) {

        remaining.splice(
          i,
          1
        );

      }

    }

  }


  return result.map(
    item =>
      item.name
  );

}


/* =========================================================
   기본 자동 순서

   위 → 아래
   같은 줄이면 왼쪽 → 오른쪽
========================================================= */

function sortDongsTopToBottom(
  positioned
) {

  const ROW_HEIGHT =
    90;


  return [
    ...positioned
  ]
    .sort(
      (a, b) => {

        const rowA =
          Math.round(
            a.y /
            ROW_HEIGHT
          );


        const rowB =
          Math.round(
            b.y /
            ROW_HEIGHT
          );


        /*
          다른 줄이면
          위 → 아래
        */

        if (
          rowA !==
          rowB
        ) {

          return (
            rowA -
            rowB
          );

        }


        /*
          같은 줄이면
          왼쪽 → 오른쪽
        */

        return (
          a.x -
          b.x
        );

      }
    )
    .map(
      item =>
        item.name
    );

}



/* =========================================================
   구별 동 목록
========================================================= */

async function getDongsForGu(
  guName
) {

  const dongData =
    await d3.json(
      "/maps/seoul-dong.geojson"
    );


  const guData =
    await d3.json(
      "/maps/seoul-gu.geojson"
    );



  /* =======================================================
     해당 구 찾기
  ======================================================= */

  const selectedGu =
    guData.features.find(
      feature =>
        feature.properties
          .SIG_KOR_NM ===
        guName
    );


  if (!selectedGu) {

    console.error(
      "구를 찾지 못했습니다:",
      guName
    );


    return [];

  }



  const guCode =
    String(
      selectedGu
        .properties
        .SIG_CD
    );



  /* =======================================================
     해당 구의 동만 추출
  ======================================================= */

  const rawFeatures =
    dongData.features.filter(
      feature =>
        String(
          feature
            .properties
            .EMD_CD
        ).startsWith(
          guCode
        )
    );



  /* =======================================================
     같은 게임 지역으로 합쳐지는 동 묶기
  ======================================================= */

  const grouped =
    d3.group(
      rawFeatures,
      feature =>
        normalizeDongName(
          feature
            .properties
            .EMD_KOR_NM
        )
    );



  const groupedFeatures =
    Array.from(
      grouped,
      (
        [
          name,
          features
        ]
      ) => ({

        name,

        geometry: {

          type:
            "FeatureCollection",

          features

        }

      })
    );


  if (
    groupedFeatures.length === 0
  ) {

    return [];

  }



  /* =======================================================
     지도 좌표 계산
  ======================================================= */

  const wholeGu = {

    type:
      "FeatureCollection",

    features:
      rawFeatures

  };


  const projection =
    d3
      .geoMercator()
      .fitExtent(
        [
          [0, 0],
          [1000, 1000]
        ],
        wholeGu
      );


  const path =
    d3.geoPath(
      projection
    );


const positioned =
  groupedFeatures.map(
    item => {

      /*
        중심점
        → 기존 기본 정렬에서도 사용
      */

      const [
        x,
        y
      ] =
        path.centroid(
          item.geometry
        );


      /*
        실제 도형의 영역 범위

        bounds 구조:

        [
          [왼쪽, 위],
          [오른쪽, 아래]
        ]
      */

      const bounds =
        path.bounds(
          item.geometry
        );


      const leftX =
        bounds[0][0];


      const topY =
        bounds[0][1];


      const rightX =
        bounds[1][0];


      const bottomY =
        bounds[1][1];


      return {

        name:
          item.name,

        /*
          중심 좌표
        */

        x,
        y,


        /*
          실제 도형 경계
        */

        leftX,
        rightX,

        topY,
        bottomY

      };

    }
  );
  



  /* =======================================================
     기본 자동 순서
  ======================================================= */

  const automaticOrder =
    sortDongsTopToBottom(
      positioned
    );



  /* =======================================================
     중구 / 용산구

     왼쪽 지역부터 시작하고
     한 열을 위→아래로 끝낸 뒤
     오른쪽으로 이동
  ======================================================= */

  if (
    guName === "중구" ||
    guName === "용산구"
  ) {

    return sortDongsLeftToRight(
      positioned
    );

  }



  /* =======================================================
     종로구

     1단계:
     구기동 → 평창동 → 부암동
     → 신영동 → 홍지동 → 청운동

     2단계:
     나머지를 왼쪽 열부터 오른쪽으로
  ======================================================= */

  if (
    guName === "종로구"
  ) {

    const actualDongNames =
      new Set(
        automaticOrder
      );


    /*
      지도에 실제 존재하는
      시작 지역만 사용
    */

    const validStartOrder =
      JONGNO_START_ORDER
        .filter(
          name =>
            actualDongNames.has(
              name
            )
        );


    /*
      시작 구간을 제외한
      나머지 종로구 지역
    */

    const remainingPositioned =
      positioned.filter(
        item =>
          !validStartOrder
            .includes(
              item.name
            )
      );


    const remainingOrder =
      sortDongsLeftToRight(
        remainingPositioned
      );


    return [

      ...validStartOrder,

      ...remainingOrder

    ];

  }



  /* =======================================================
     기존 수동 지정 구
  ======================================================= */

  const manualOrder =
    MANUAL_DONG_ORDERS[
      guName
    ];


  /*
    수동 지정이 없으면
    기존 자동 순서
  */

  if (!manualOrder) {

    return automaticOrder;

  }



  /* =======================================================
     수동 목록 검증
  ======================================================= */

  const actualDongNames =
    new Set(
      automaticOrder
    );


  const validManualOrder =
    manualOrder.filter(
      name => {

        const exists =
          actualDongNames.has(
            name
          );


        if (!exists) {

          console.warn(
            `[${guName}] 지도 데이터에 없는 지역명:`,
            name
          );

        }


        return exists;

      }
    );



  /*
    수동 목록에서 빠진 동이 있어도
    게임에서 삭제하지 않는다.

    자동 순서 기준으로
    목록 뒤에 붙인다.
  */

  const missingDongs =
    automaticOrder.filter(
      name =>
        !validManualOrder
          .includes(
            name
          )
    );


  return [

    ...validManualOrder,

    ...missingDongs

  ];

}

async function showTypingScreen(guName) {

    // 일반 지역 게임은
  // 새 도전마다 새 서버 세션 사용
  if (gameMode !== "tour") {
    currentGameSessionId = null;
    currentGameSessionPromise = null;
  }

  const dongs = await getDongsForGu(guName);
  let currentIndex = 0;
  const completedDongs = [];
    let startTime = null;
let timerInterval = null;
let keyStrokeCount = 0;

let accuracyCorrect = 0;
let accuracyWrong = 0;

let expectedKeyIndex = 0;

/*
  현재 입력 중인 동에서
  실제로 맞게 남아 있는 키 수

  정답을 입력했다가 지우면
  이 숫자도 다시 감소한다.
*/
let currentValidKeyCount = 0;

  app.innerHTML = `
  <main
  class="
    typing-screen
    map-size-${gameSettings.mapSize}
    target-size-${gameSettings.targetTextSize}
  "
>

    <button id="typing-back-button" class="typing-back-button">
      ← 뒤로
    </button>

    <div class="typing-brand">
      SEOUL TYPING
    </div>

    <section class="typing-gu-header">
      <p>현재 지역</p>
      <h1>${guName}</h1>
    </section>

    ${
  gameMode === "tour"
    ? `
      <aside class="tour-mini-panel">

        <div class="tour-mini-header">

          <strong class="tour-mini-title-new">
            서울 종주
          </strong>

          <div class="tour-gu-progress">

            <strong id="tour-current-gu-count">
              ${tourGuIndex + 1}
              <span>
                / ${seoulGuOrder.length}
              </span>
            </strong>

            <small>
              구
            </small>

          </div>

        </div>


        <div id="tour-mini-map"></div>


        <div class="tour-progress-text">

          <strong id="tour-progress-percent">
            0%
          </strong>

          <span id="tour-progress-count">
            0 / ${tourTotalDongCount}
          </span>

        </div>


        <div class="tour-progress-bar">
          <div id="tour-progress-fill"></div>
        </div>

      </aside>
    `
    : ""
}

    <section class="game-main-area">

      <div id="gu-map"></div>

      <div class="destination-area">

        <p class="destination-label">
          현재 목적지
        </p>

        <div class="dong-navigation">

          <span id="prev-dong" class="side-dong"></span>

          <span class="nav-arrow">←</span>

          <h2 id="current-dong"></h2>

          <span class="nav-arrow">→</span>

          <span id="next-dong" class="side-dong"></span>

        </div>

      </div>

      <input
        id="typing-input"
        class="typing-input"
        type="text"
        placeholder="여기에 입력"
        autocomplete="off"
      />

      <section class="typing-stats">

        <div class="stat-item">
          <div class="stat-icon speed-icon">
            ◴
          </div>

          <div>
            <span class="stat-label">타수</span>
            <strong id="typing-speed">0</strong>
          </div>
        </div>

        <div class="stat-item">
          <div class="stat-icon accuracy-icon">
            ◎
          </div>

          <div>
            <span class="stat-label">정확도</span>
            <strong>
              <span id="accuracy-count">100</span>%
            </strong>
          </div>
        </div>

        <div class="stat-item">
          <div class="stat-icon time-icon">
            ◷
          </div>

          <div>
            <span class="stat-label">시간</span>
            <strong>
              <span id="time-count">0.0</span>초
            </strong>
          </div>
        </div>

        <div class="stat-item">
          <div class="stat-icon progress-icon">
            ☷
          </div>

          <div>
            <span class="stat-label">진행도</span>
            <strong id="progress-count">
              0 / ${dongs.length}
            </strong>
          </div>
        </div>

      </section>

    </section>

  </main>
`;

  function leaveTypingScreen() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }


  // 서울 종주
  // → 종주 완전히 종료하고 홈으로
  if (gameMode === "tour") {
    gameMode = "region";

    tourGuIndex = 0;
    tourResults = [];

    tourStartTime = null;
    tourKeyStrokeCount = 0;

    tourAccuracyCorrect = 0;
    tourAccuracyWrong = 0;

    tourCompletedDongCount = 0;

    showHomeScreen();

    return;
  }


  // 일반 지역 모드
  // → 현재 구의 시작 화면으로
  showGuStartScreen(guName);
}


document
  .querySelector("#typing-back-button")
  .addEventListener("click", () => {
    leaveTypingScreen();
  });


  const typingInput = document.querySelector("#typing-input");
  const currentDongText = document.querySelector("#current-dong");
  const prevDongText = document.querySelector("#prev-dong");
const nextDongText = document.querySelector("#next-dong");
  const progressCount = document.querySelector("#progress-count");
  const timeCount = document.querySelector("#time-count");
  const typingSpeed = document.querySelector("#typing-speed");
  const accuracyCount = document.querySelector("#accuracy-count");

  if (gameMode === "tour" && tourStartTime !== null) {
  const tourElapsed =
    (Date.now() - tourStartTime) / 1000;

  const tourSpeed =
    tourElapsed > 0
      ? Math.round(
          (tourKeyStrokeCount / tourElapsed) * 60
        )
      : 0;

  const tourAccuracyTotal =
    tourAccuracyCorrect + tourAccuracyWrong;

  const tourAccuracy =
    tourAccuracyTotal === 0
      ? 100
      : Math.round(
          (tourAccuracyCorrect / tourAccuracyTotal) * 100
        );

  typingSpeed.textContent = tourSpeed;
  timeCount.textContent = tourElapsed.toFixed(1);
  accuracyCount.textContent = tourAccuracy;
}

if (gameMode === "tour" && tourStartTime !== null) {
  timerInterval = setInterval(() => {
    updateTimerAndSpeed();
  }, 100);
}

  function renderDongNavigation() {
  const prevDong =
    currentIndex > 0
      ? dongs[currentIndex - 1]
      : "";

  const nextDong =
    currentIndex < dongs.length - 1
      ? dongs[currentIndex + 1]
      : "";

  prevDongText.textContent = prevDong;
  nextDongText.textContent = nextDong;
}

function renderCurrentDong() {
  const target = dongs[currentIndex];
  const typed = typingInput.value;

  if (!target) {
    currentDongText.textContent = "";
    return;
  }

  /*
    한글 IME 조합 중에는
    "호"가 최종 목표 "화"와 다르더라도
    아직 정상적인 입력 과정일 수 있다.

    따라서 완성 한글 글자 자체를 비교하지 않고,
    실제 두벌식 키 입력 순서를 기준으로 판정한다.
  */

  const targetKeys =
    koreanToKeys(target);

  const typedKeys =
    koreanToKeys(typed);

  const isStillValid =
    targetKeys.startsWith(typedKeys);

  /*
    아직 아무것도 입력하지 않은 경우
  */

  if (typed.length === 0) {
    currentDongText.innerHTML =
      [...target]
        .map(
          char =>
            `<span class="pending-char">${char}</span>`
        )
        .join("");

    return;
  }

  /*
    현재 입력이 목표의 정상적인 중간 과정이면
    입력된 부분을 초록색으로 표시.

    IME 조합 특성상 화면상의 글자 단위와
    실제 키 입력 단위가 다르므로
    현재 조합 중인 첫 글자까지 정상 처리한다.
  */

  if (isStillValid) {
    const typedLength =
      Math.min(
        typed.length,
        target.length
      );

    let html = "";

    for (
      let i = 0;
      i < target.length;
      i++
    ) {
      if (i < typedLength) {
        html +=
          `<span class="correct-char">${target[i]}</span>`;
      } else {
        html +=
          `<span class="pending-char">${target[i]}</span>`;
      }
    }

    currentDongText.innerHTML = html;
    return;
  }

  /*
    목표 키 입력 경로에서 완전히 벗어난 경우에만
    빨간색 표시
  */

  let html = "";

  for (
    let i = 0;
    i < target.length;
    i++
  ) {
    if (i < typed.length) {
      html +=
        `<span class="wrong-char">${target[i]}</span>`;
    } else {
      html +=
        `<span class="pending-char">${target[i]}</span>`;
    }
  }

  currentDongText.innerHTML = html;
}

  typingInput.focus();

renderCurrentDong();
renderDongNavigation();


function ensureGameTimerStarted() {
  if (startTime !== null) {
    return;
  }

  const now = Date.now();

  startTime = now;

  if (
    gameMode === "tour" &&
    tourStartTime === null
  ) {
    tourStartTime = now;
  }

  /* 서버 게임 세션 생성 */
  if (
    !currentGameSessionId &&
    !currentGameSessionPromise
  ) {
    const sessionMode =
      gameMode === "tour"
        ? "tour"
        : "region";

    const sessionTarget =
      gameMode === "tour"
        ? "서울특별시"
        : guName;

    currentGameSessionPromise =
      startGameSession(
        sessionMode,
        sessionTarget
      );
  }

  if (timerInterval) {
    clearInterval(timerInterval);
  }

  timerInterval =
    setInterval(
      () => {
        updateTimerAndSpeed();
      },
      100
    );
}


function updateTimerAndSpeed() {
  if (gameMode === "tour") {
    if (tourStartTime === null) return;

    const elapsed =
      (Date.now() - tourStartTime) / 1000;

    timeCount.textContent =
      elapsed.toFixed(1);

    if (elapsed > 0) {
      const speed = Math.round(
        (tourKeyStrokeCount / elapsed) * 60
      );

      typingSpeed.textContent = speed;
    }

    return;
  }

  if (startTime === null) return;

  const elapsed =
    (Date.now() - startTime) / 1000;

  timeCount.textContent =
    elapsed.toFixed(1);

  if (elapsed > 0) {
    const speed = Math.round(
      (keyStrokeCount / elapsed) * 60
    );

    typingSpeed.textContent = speed;
  }
}

typingInput.addEventListener(
  "keydown",
  (event) => {

    /* =====================================================
       BACKSPACE
    ===================================================== */

    if (
      event.key === "Backspace"
    ) {

      /*
        실제 입력된 내용이 있을 때만
        삭제 효과음
      */

      if (
        typingInput.value.length > 0
      ) {

        playSoundEffect(
          "back"
        );

      }


      /*
        타수 계산은 여기서 직접 건드리지 않는다.

        실제 삭제가 끝난 뒤 발생하는
        input 이벤트에서 정확하게 다시 계산한다.
      */

      return;
    }


    /* =====================================================
       알파벳 키만 게임 입력으로 처리
    ===================================================== */

    if (
      !event.code.startsWith(
        "Key"
      )
    ) {
      return;
    }


    const isMobileDevice =
  /iPhone|iPad|iPod|Android/i.test(
    navigator.userAgent
  );

if (!isMobileDevice) {
  playSoundEffect(
    "typing"
  );
}


    /* =====================================================
       TIMER START
    ===================================================== */

   ensureGameTimerStarted();


    /* =====================================================
       정확도 판정
    ===================================================== */

    const expectedKeys =
      koreanToKeys(
        dongs[currentIndex]
      );


    let pressedKey =
      event.code
        .replace(
          "Key",
          ""
        )
        .toLowerCase();


    if (
      event.shiftKey
    ) {

      pressedKey =
        pressedKey.toUpperCase();

    }


    /*
      여기서는 타수를 올리지 않는다.

      실제 input 결과를 확인한 다음
      타수를 계산한다.
    */


    if (
      pressedKey ===
      expectedKeys[
        expectedKeyIndex
      ]
    ) {

      accuracyCorrect++;


      if (
        gameMode === "tour"
      ) {

        tourAccuracyCorrect++;

      }


      /*
        다음 키 판정을 위해
        임시로 이동.

        실제 입력 후 input 이벤트에서
        다시 정확한 위치로 맞춘다.
      */

      expectedKeyIndex++;

    }

    else {

      accuracyWrong++;


      if (
        gameMode === "tour"
      ) {

        tourAccuracyWrong++;

      }

    }


    /* =====================================================
       정확도 표시
    ===================================================== */

    let accuracy;


    if (
      gameMode === "tour"
    ) {

      const totalTourAccuracy =
        tourAccuracyCorrect +
        tourAccuracyWrong;


      accuracy =
        totalTourAccuracy === 0
          ? 100
          : Math.round(
              (
                tourAccuracyCorrect /
                totalTourAccuracy
              ) *
              100
            );

    }

    else {

      const totalAccuracy =
        accuracyCorrect +
        accuracyWrong;


      accuracy =
        totalAccuracy === 0
          ? 100
          : Math.round(
              (
                accuracyCorrect /
                totalAccuracy
              ) *
              100
            );

    }


    accuracyCount.textContent =
      accuracy;


    updateTimerAndSpeed();

  }
);


  drawGuMap(
  guName,
  dongs[currentIndex],
  completedDongs,
  dongs[currentIndex + 1] || null
);

  if (gameMode === "tour") {
  drawTourMiniMap();
  updateTourProgress();
}

  function checkAnswer() {
  if (typingInput.value.trim() !== dongs[currentIndex]) {
    return;
  }

playSoundEffect("dong");

  completedDongs.push(dongs[currentIndex]);

  if (gameMode === "tour") {
  tourCompletedDongCount++;
  updateTourProgress();
}

  currentIndex++;

typingInput.value = "";

expectedKeyIndex = 0;

currentValidKeyCount = 0;

  progressCount.textContent =
    `${currentIndex} / ${dongs.length}`;

  if (currentIndex >= dongs.length) {


    clearInterval(timerInterval);

    const finalTime =
      (Date.now() - startTime) / 1000;

    const finalSpeed = Math.round(
      (keyStrokeCount / finalTime) * 60
    );

    const totalAccuracyInputs =
      accuracyCorrect + accuracyWrong;

    const accuracy =
      totalAccuracyInputs === 0
        ? 100
        : Math.round(
            (accuracyCorrect / totalAccuracyInputs) * 100
          );

    if (gameMode === "tour") {
  tourResults.push({
    guName,
    completedCount: completedDongs.length,
    finalTime,
    finalSpeed,
    accuracy
  });

  tourGuIndex++;

  if (tourGuIndex < seoulGuOrder.length) {
  showTypingScreen(seoulGuOrder[tourGuIndex]);
  return;
}

  const tourFinalTime =
  (Date.now() - tourStartTime) / 1000;

const tourFinalSpeed = Math.round(
  (tourKeyStrokeCount / tourFinalTime) * 60
);

const tourTotalAccuracy =
  tourAccuracyCorrect + tourAccuracyWrong;

const tourFinalAccuracy =
  tourTotalAccuracy === 0
    ? 100
    : Math.round(
        (tourAccuracyCorrect / tourTotalAccuracy) * 100
      );

showTourResultScreen(
  tourFinalTime,
  tourFinalSpeed,
  tourFinalAccuracy
);

return;

}

function showTourTransitionScreen(
  finishedGuName,
  nextGuName,
  finalTime,
  finalSpeed,
  accuracy
) {
  app.innerHTML = `
    <main class="tour-transition-screen">
      <div class="tour-transition-card">

        <p class="tour-transition-label">
          지역 완료
        </p>

        <h2>
          🎉 ${finishedGuName} 완료!
        </h2>

        <div class="tour-transition-stats">
          <div>
            <span>시간</span>
            <strong>${finalTime.toFixed(1)}초</strong>
          </div>

          <div>
            <span>평균 타수</span>
            <strong>${finalSpeed}타</strong>
          </div>

          <div>
            <span>정확도</span>
            <strong>${accuracy}%</strong>
          </div>
        </div>

        <div class="tour-next-area">
          <span>다음 지역</span>
          <h3>${nextGuName}</h3>
        </div>

        <button id="continue-tour-button">
          계속하기 →
        </button>

      </div>
    </main>
  `;

  document
    .querySelector("#continue-tour-button")
    .addEventListener("click", () => {
      showTypingScreen(nextGuName);
    });
}

saveGuRecord(
  guName,
  finalTime,
  finalSpeed,
  accuracy,
  accuracyWrong
);

showGuResultScreen(
  guName,
  completedDongs.length,
  finalTime,
  finalSpeed,
  accuracy
);

return;

  }


  renderCurrentDong();
  renderDongNavigation();

const nextDong =
  currentIndex <
  dongs.length - 1
    ? dongs[
        currentIndex + 1
      ]
    : null;


updateGuMapColors(
  guName,
  dongs[currentIndex],
  completedDongs,
  nextDong
);


moveGuMapToDong(
  dongs[currentIndex],
  nextDong
);

function moveGuMapToDong(
  currentDong,
  nextDong = null
) {
  if (
    !guSvg ||
    !guPaths
  ) {
    return;
  }


  const width = 700;
  const height = 520;


  const uniqueDongNames = [
    ...new Set(
      guPaths
        .data()
        .map(
          d =>
            normalizeDongName(
              d.properties.EMD_KOR_NM
            )
        )
    )
  ];


  const mapSettings =
    getMapDisplaySettings(
      uniqueDongNames.length
    );


  /*
    다음 지역까지 같이 보여야 하므로
    기존 확대보다 아주 조금만 축소
  */

  const zoomScale =
    mapSettings.zoom *
    (nextDong ? 0.92 : 1);


  const allFeatures =
    guPaths.data();


  const projection =
    d3
      .geoMercator()
      .fitExtent(
        [
          [20, 20],
          [
            width - 20,
            height - 20
          ]
        ],
        {
          type:
            "FeatureCollection",

          features:
            allFeatures
        }
      );


  const path =
    d3.geoPath(
      projection
    );


  function getDongCentroid(
    dongName
  ) {

    if (!dongName) {
      return null;
    }


    const features =
      allFeatures.filter(
        d =>
          normalizeDongName(
            d.properties.EMD_KOR_NM
          ) ===
          dongName
      );


    if (
      features.length === 0
    ) {
      return null;
    }


    return path.centroid({
      type:
        "FeatureCollection",

      features
    });

  }


  const currentCenter =
    getDongCentroid(
      currentDong
    );


  if (!currentCenter) {
    return;
  }


  const nextCenter =
    getDongCentroid(
      nextDong
    );


  let centerX =
    currentCenter[0];

  let centerY =
    currentCenter[1];


  /*
    다음 지역이 있으면
    두 지역의 중간점을 화면 중앙으로
  */

  if (nextCenter) {

    centerX =
      (
        currentCenter[0] +
        nextCenter[0]
      ) / 2;

    centerY =
      (
        currentCenter[1] +
        nextCenter[1]
      ) / 2;

  }


  guSvg
    .select(
      "#map-layer"
    )
    .transition()
    .duration(650)
    .ease(
      d3.easeCubicInOut
    )
    .attr(
      "transform",
      `
        translate(
          ${width / 2},
          ${height / 2}
        )
        scale(
          ${zoomScale}
        )
        translate(
          ${-centerX},
          ${-centerY}
        )
      `
    );
}

}

typingInput.addEventListener(
  "input",
  () => {

      ensureGameTimerStarted();

    /* =====================================================
       실제로 맞게 입력되어 있는 키 수 계산
    ===================================================== */

    const targetKeys =
      koreanToKeys(
        dongs[currentIndex]
      );


    const typedKeys =
      koreanToKeys(
        typingInput.value
      );


    /*
      목표 문자열과 현재 입력 문자열이
      앞에서부터 몇 키까지 일치하는지 계산
    */

    let validKeyCount =
      0;


    const compareLength =
      Math.min(
        targetKeys.length,
        typedKeys.length
      );


    for (
      let i = 0;
      i < compareLength;
      i++
    ) {

      if (
        targetKeys[i] !==
        typedKeys[i]
      ) {
        break;
      }


      validKeyCount++;

    }


    /* =====================================================
       타수 증감량 계산
    ===================================================== */

    const difference =
      validKeyCount -
      currentValidKeyCount;


    /*
      정답이 새로 입력되면 +
      정답을 Backspace로 지우면 -

      즉 정답을 썼다 지웠다 반복해도
      타수를 올릴 수 없다.
    */

    if (
      difference !== 0
    ) {

      keyStrokeCount =
        Math.max(
          0,
          keyStrokeCount +
          difference
        );


      if (
        gameMode === "tour"
      ) {

        tourKeyStrokeCount =
          Math.max(
            0,
            tourKeyStrokeCount +
            difference
          );

      }

    }


    currentValidKeyCount =
      validKeyCount;


    /*
      Backspace나 한글 조합 변화가 발생해도
      다음에 입력해야 하는 키 위치를
      실제 입력 내용에 맞춰 다시 동기화
    */

    expectedKeyIndex =
      validKeyCount;


    /* 화면 */

    renderCurrentDong();


    /* 정답 완성 확인 */

    checkAnswer();


    /* 타수 즉시 갱신 */

    updateTimerAndSpeed();

  }
);

}

async function drawTourMiniMap() {
  const container = document.querySelector("#tour-mini-map");

  if (!container) return;

  const data = await d3.json("/maps/seoul-gu.geojson");

  container.innerHTML = "";

  const width = 230;
  const height = 170;

  const svg = d3
    .select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%");

  const projection = d3
    .geoMercator()
    .fitExtent(
      [
        [5, 5],
        [width - 5, height - 5]
      ],
      data
    );

  const path = d3.geoPath(projection);

  const currentGuName =
    seoulGuOrder[tourGuIndex];

  const completedGuNames =
    seoulGuOrder.slice(0, tourGuIndex);

  svg
    .selectAll("path")
    .data(data.features)
    .join("path")
    .attr("d", path)
    .attr("fill", d => {
      const name = d.properties.SIG_KOR_NM;

      if (completedGuNames.includes(name)) {
        return "#8FD8B8";
      }

      if (name === currentGuName) {
        return "#FFE9A8";
      }

      return "#E5E7EB";
    })
    .attr("stroke", "#FFFFFF")
    .attr("stroke-width", 1.3);
}

function updateTourProgress() {

  if (
    gameMode !== "tour"
  ) {
    return;
  }


  const percentElement =
    document.querySelector(
      "#tour-progress-percent"
    );


  const countElement =
    document.querySelector(
      "#tour-progress-count"
    );


  const fillElement =
    document.querySelector(
      "#tour-progress-fill"
    );


  const currentGuElement =
    document.querySelector(
      "#tour-current-gu-count"
    );


  const percent =
    tourTotalDongCount === 0
      ? 0
      : (
          tourCompletedDongCount /
          tourTotalDongCount
        ) * 100;


  if (percentElement) {

    percentElement.textContent =
      `${percent.toFixed(1)}%`;

  }


  if (countElement) {

    countElement.textContent =
      `${tourCompletedDongCount} / ${tourTotalDongCount}`;

  }


  if (fillElement) {

    fillElement.style.width =
      `${percent}%`;

  }


  if (currentGuElement) {

    currentGuElement.innerHTML = `
      ${tourGuIndex + 1}
      <span>
        / ${seoulGuOrder.length}
      </span>
    `;

  }

}

function getMapDisplaySettings(dongCount) {
  let zoom;
  let fontSize;

  if (dongCount <= 15) {
    zoom = 1.25;
    fontSize = 16;
  } else if (dongCount <= 25) {
    zoom = 1.45;
    fontSize = 14;
  } else if (dongCount <= 35) {
    zoom = 1.65;
    fontSize = 12;
  } else {
    zoom = 1.9;
    fontSize = 10;
  }


  /* 지도 확대 설정 */

  if (gameSettings.mapSize === "small") {
    zoom *= 0.88;
  }

  if (gameSettings.mapSize === "large") {
    zoom *= 1.13;
  }


  /* 지역명 글자 크기 설정 */

  if (gameSettings.labelSize === "small") {
    fontSize *= 0.82;
  }

  if (gameSettings.labelSize === "large") {
    fontSize *= 1.22;
  }


  return {
    zoom,
    fontSize
  };
}

/* =========================================================
   지도 지역명 충돌 방지
========================================================= */

function arrangeGuLabels(
  labelGroups,
  currentDong,
  nextDong,
  completedDongs,
  isDenseGu,
  baseFontSize
) {

  /*
    매번 원래 위치에서 다시 계산
  */

  /*
  완료되지 않은 라벨만 원래 위치에서 다시 계산한다.

  이미 완료된 라벨은
  마지막으로 확정된 위치를 그대로 유지한다.
*/
labelGroups.forEach(label => {

  const isCompleted =
    completedDongs.includes(
      label.name
    );

  if (isCompleted) {

  /*
    완료된 지역명은
    해당 지역의 원래 중앙에 고정한다.

    더 이상 충돌 회피 때문에
    이리저리 움직이지 않는다.
  */

  label.x =
    label.originalX;

  label.y =
    label.originalY;

  label.fixedX =
    label.originalX;

  label.fixedY =
    label.originalY;

  return;
}

  label.x = label.originalX;
  label.y = label.originalY;

});


  /*
    현재 화면에 실제로 보이는 글자만
    충돌 계산에 사용
  */

  const visibleLabels =
    labelGroups.filter(label => {

      if (!isDenseGu) {
        return true;
      }

      return (
        label.name === currentDong ||
        label.name === nextDong ||
        completedDongs.includes(
          label.name
        )
      );

    });


  function getFontSize(label) {

  // 성동구, 서초구처럼
  // 모든 지역명이 보이는 구
  // → 전부 같은 크기
  if (!isDenseGu) {
    return baseFontSize;
  }

  // 종로구처럼 지역이 복잡한 구
  // → 현재 지역은 크게
  if (
    label.name === currentDong
  ) {
    return baseFontSize + 4;
  }

  // 다음 지역은 현재보다 조금 작게
  if (
    label.name === nextDong
  ) {
    return baseFontSize + 1;
  }

  // 완료된 지역은 작게
  if (
    completedDongs.includes(
      label.name
    )
  ) {
    return Math.max(
      5,
      baseFontSize - 5
    );
  }

  return baseFontSize;
}


  /*
    글자가 서로 닿으면 조금씩 밀어냄.
    지도 위치에서 너무 멀리 벗어나지는 않게 제한.
  */

  for (
    let iteration = 0;
    iteration < 70;
    iteration++
  ) {

    for (
      let i = 0;
      i < visibleLabels.length;
      i++
    ) {

      for (
        let j = i + 1;
        j < visibleLabels.length;
        j++
      ) {

        const a =
          visibleLabels[i];

        const b =
          visibleLabels[j];

          const aFixed =
  completedDongs.includes(
    a.name
  );

const bFixed =
  completedDongs.includes(
    b.name
  );


        const fontA =
          getFontSize(a);

        const fontB =
          getFontSize(b);


        /*
          한글 글자 폭을 대략 계산
        */

        const widthA =
          a.name.length *
            fontA *
            0.9 +
          12;

        const widthB =
          b.name.length *
            fontB *
            0.9 +
          12;


        const heightA =
          fontA + 10;

        const heightB =
          fontB + 10;


        const dx =
          b.x - a.x;

        const dy =
          b.y - a.y;


        const overlapX =
          (
            widthA +
            widthB
          ) / 2 +
          8 -
          Math.abs(dx);


        const overlapY =
          (
            heightA +
            heightB
          ) / 2 +
          5 -
          Math.abs(dy);


        if (
          overlapX <= 0 ||
          overlapY <= 0
        ) {
          continue;
        }


        /*
          현재/다음 목적지는
          다른 글자보다 조금 더 넉넉하게 분리
        */

        const important =
          a.name === currentDong ||
          a.name === nextDong ||
          b.name === currentDong ||
          b.name === nextDong;


        const power =
          important
            ? 0.65
            : 0.45;


        /*
          덜 겹치는 방향으로 밀기
        */

        if (
          overlapX <
          overlapY
        ) {

          const direction =
            dx >= 0
              ? 1
              : -1;


          const move =
            overlapX *
            power;


          if (aFixed && bFixed) {

  /*
    둘 다 완료된 지역이면
    아무것도 움직이지 않는다.
  */
  continue;

} else if (aFixed) {

  /*
    a는 고정
    b만 이동
  */
  b.x += direction * move * 2;

} else if (bFixed) {

  /*
    b는 고정
    a만 이동
  */
  a.x -= direction * move * 2;

} else {

  /*
    둘 다 미완료면
    기존처럼 서로 반씩 이동
  */
  a.x -= direction * move;
  b.x += direction * move;

}

        } else {

          const direction =
            dy >= 0
              ? 1
              : -1;


          const move =
            overlapY *
            power;


          if (aFixed && bFixed) {

  continue;

} else if (aFixed) {

  b.y += direction * move * 2;

} else if (bFixed) {

  a.y -= direction * move * 2;

} else {

  a.y -= direction * move;
  b.y += direction * move;

}

        }

      }

    }


    /*
      원래 지도 위치 쪽으로
      아주 조금씩 당김
    */

    visibleLabels.forEach(
      label => {

        if (
  completedDongs.includes(
    label.name
  )
) {
  return;
}

        label.x +=
          (
            label.originalX -
            label.x
          ) * 0.025;

        label.y +=
          (
            label.originalY -
            label.y
          ) * 0.025;


        /*
          실제 동에서 너무 멀리
          떨어지지 않도록 제한
        */

        const MAX_OFFSET = 38;


        label.x =
          Math.max(
            label.originalX -
              MAX_OFFSET,
            Math.min(
              label.originalX +
                MAX_OFFSET,
              label.x
            )
          );


        label.y =
          Math.max(
            label.originalY -
              MAX_OFFSET,
            Math.min(
              label.originalY +
                MAX_OFFSET,
              label.y
            )
          );

      }
    );

  }

/*
  이번 프레임에서 완료 상태인 지역은
  현재 위치를 영구 고정한다.
*/



}

async function drawGuMap(
  guName,
  currentDong,
  completedDongs = [],
  nextDong = null
) {
  const dongData = await d3.json("/maps/seoul-dong.geojson");
  const guData = await d3.json("/maps/seoul-gu.geojson");

  const selectedGu = guData.features.find(
    d => d.properties.SIG_KOR_NM === guName
  );

  if (!selectedGu) return;

  const guCode = selectedGu.properties.SIG_CD;

  const filteredDongs = dongData.features.filter(
    d =>
      String(d.properties.EMD_CD)
        .startsWith(String(guCode))
  );

  const uniqueDongNames = [
  ...new Set(
    filteredDongs.map(
      d => normalizeDongName(d.properties.EMD_KOR_NM)
    )
  )
];

const mapSettings =
  getMapDisplaySettings(uniqueDongNames.length);

const zoomScale = mapSettings.zoom;
const labelFontSize = mapSettings.fontSize;

  const selectedGuData = {
    type: "FeatureCollection",
    features: filteredDongs
  };

  const width = 700;
  const height = 520;

  const mapContainer = document.querySelector("#gu-map");
  mapContainer.innerHTML = "";

  guSvg = d3
  .select(mapContainer)
  .append("svg")
  .attr("viewBox", `0 0 ${width} ${height}`)
  .attr("width", "100%");

 

  const projection = d3
    .geoMercator()
    .fitExtent(
      [
        [20, 20],
        [width - 20, height - 20]
      ],
      selectedGuData
    );

    const path = d3.geoPath(projection);

    const currentFeatures = filteredDongs.filter(
  d =>
    normalizeDongName(d.properties.EMD_KOR_NM) === currentDong
);


const currentFeatureCollection = {
  type: "FeatureCollection",
  features: currentFeatures
};


const currentCentroid =
  currentFeatures.length > 0
    ? path.centroid(
        currentFeatureCollection
      )
    : [
        width / 2,
        height / 2
      ];


/* =========================================
   다음 지역의 중심도 계산
========================================= */

const nextFeatures =
  nextDong
    ? filteredDongs.filter(
        d =>
          normalizeDongName(
            d.properties.EMD_KOR_NM
          ) ===
          nextDong
      )
    : [];


const nextFeatureCollection = {
  type:
    "FeatureCollection",

  features:
    nextFeatures
};


const nextCentroid =
  nextFeatures.length > 0
    ? path.centroid(
        nextFeatureCollection
      )
    : null;


/* =========================================
   처음부터 현재 + 다음 지역이
   함께 보이도록 중앙 계산
========================================= */

let initialCenterX =
  currentCentroid[0];

let initialCenterY =
  currentCentroid[1];


if (nextCentroid) {

  initialCenterX =
    (
      currentCentroid[0] +
      nextCentroid[0]
    ) / 2;


  initialCenterY =
    (
      currentCentroid[1] +
      nextCentroid[1]
    ) / 2;
}


/*
  다음 목적지가 있으면
  아주 조금 축소해서 둘 다 잘 보이게
*/

const initialZoomScale =
  zoomScale *
  (
    nextDong
      ? 0.92
      : 1
  );


guSvg
  .append("g")
  .attr(
    "id",
    "map-layer"
  )
  .attr(
    "transform",
    `
      translate(
        ${width / 2},
        ${height / 2}
      )
      scale(
        ${initialZoomScale}
      )
      translate(
        ${-initialCenterX},
        ${-initialCenterY}
      )
    `
  );
 

  const mapLayer = guSvg.select("#map-layer");

guPaths = mapLayer
  .selectAll("path")
    .data(filteredDongs)
    .join("path")
    .attr("d", path)
    .attr("fill", d => {
  const name = normalizeDongName(d.properties.EMD_KOR_NM);

      if (
  completedDongs.includes(name)
) {
  return "#8FD8B8";
}

if (
  name === currentDong
) {
  return "#FFE9A8";
}

else if (
  name === nextDong
) {
  return "#C8CED8";
}

return "#D8DEE9";
    })
    .attr("stroke", "#FFFFFF")
    .attr("stroke-width", 2);

  
const labelGroups = Array.from(
  d3.group(
    filteredDongs,
    d => normalizeDongName(d.properties.EMD_KOR_NM)
  ),
  ([name, features]) => {
    const groupData = {
      type: "FeatureCollection",
      features
    };

    const [x, y] = path.centroid(groupData);

    return {
      name,
      features,
      originalX: x,
      originalY: y,
      x,
      y
    };
  }
);


const denseGuNames = [
  "용산구",
  "서대문구",
  "종로구",
  "중구"
];

const isDenseGu =
  labelGroups.length > 20 ||
  denseGuNames.includes(guName);

 arrangeGuLabels(
  labelGroups,
  currentDong,
  nextDong,
  completedDongs,
  isDenseGu,
  labelFontSize
); 

guLabels = mapLayer
  .selectAll(".dong-label")
  .data(labelGroups)
  .join("text")

  .attr(
    "class",
    "dong-label"
  )

  .attr(
  "x",
  d => d.x
)

.attr(
  "y",
  d => d.y
)

  .attr(
    "text-anchor",
    "middle"
  )

  .attr(
    "dominant-baseline",
    "middle"
  )


  /* =========================
     글자 크기
  ========================= */

  .attr(
  "font-size",
  d => {

    /*
      지역이 많지 않은 구:
      모든 지역명을 같은 크기로 표시
    */
    if (!isDenseGu) {
      return labelFontSize;
    }


    /*
      지역이 많은 구만
      중요도에 따라 크기 차등
    */

    if (
      d.name === currentDong
    ) {
      return labelFontSize + 4;
    }


    if (
      d.name === nextDong
    ) {
      return labelFontSize + 1;
    }


    if (
      completedDongs.includes(
        d.name
      )
    ) {
      return Math.max(
        5,
        labelFontSize - 5
      );
    }


    return labelFontSize;
  }
)


  /* =========================
     굵기
  ========================= */

  .attr(
    "font-weight",
    d => {

      if (
        d.name === currentDong
      ) {
        return 800;
      }


      if (
        d.name === nextDong
      ) {
        return 700;
      }


      if (
        completedDongs.includes(
          d.name
        )
      ) {
        return 600;
      }


      return 500;
    }
  )


  /* =========================
     글자 색
  ========================= */

  .attr(
    "fill",
    d => {

      if (
        d.name === currentDong
      ) {
        return "#111827";
      }


      if (
  d.name === nextDong
) {
  return "#5F6875";
}


      if (
        completedDongs.includes(
          d.name
        )
      ) {
        return "#4B7665";
      }


      return "#6B7280";
    }
  )


  /* =========================
     표시 여부
  ========================= */

  .attr(
    "opacity",
    d => {

      /*
        동이 많지 않은 구는
        모든 지역명을 그대로 표시
      */

      if (!isDenseGu) {
        return 1;
      }


      /*
        동이 많은 구에서도
        현재 지역은 반드시 표시
      */

      if (
        d.name === currentDong
      ) {
        return 1;
      }


      /*
        다음 지역 역시 반드시 표시
      */

      if (
        d.name === nextDong
      ) {
        return 1;
      }


      /*
        이미 완료한 지역은
        약간 흐리게 표시
      */

      if (
        completedDongs.includes(
          d.name
        )
      ) {
        return 0.7;
      }


      /*
        아직 한참 남은 지역은 숨김
      */

      return 0;
    }
  )


  .style(
    "pointer-events",
    "none"
  )


  /* =========================
     지도에 표시할 글자
  ========================= */

  .text(d => d.name);

}

function updateGuMapColors(
  guName,
  currentDong,
  completedDongs,
  nextDong = null
) {
  if (!guPaths) return;


  /*
    지도 영역 색
  */

  guPaths.each(
    function (d) {

      const name =
        normalizeDongName(
          d.properties.EMD_KOR_NM
        );

      const element =
        d3.select(this);


      let color =
        "#D8DEE9";


      if (
        completedDongs.includes(
          name
        )
      ) {
        color =
          "#8FD8B8";

      } else if (
        name === currentDong
      ) {
        color =
          "#FFE9A8";

      } else if (
  name === nextDong
) {
  color =
    "#C8CED8";
}


      element
        .transition()
        .duration(300)
        .attr(
          "fill",
          color
        );

    }
  );


  if (!guLabels) {
    return;
  }


  const denseGuNames = [
    "용산구",
    "서대문구",
    "종로구",
    "중구"
  ];


  const isDenseGu =
    guLabels.data().length >
      20 ||
    denseGuNames.includes(
      guName
    );


  const labelFontSize =
    getMapDisplaySettings(
      guLabels.data().length
    ).fontSize;

    const labelData =
  guLabels.data();


arrangeGuLabels(
  labelData,
  currentDong,
  nextDong,
  completedDongs,
  isDenseGu,
  labelFontSize
);


guLabels
  .attr(
    "x",
    d => d.x
  )
  .attr(
    "y",
    d => d.y
  );


  guLabels

    .attr(
      "opacity",
      d => {

        if (!isDenseGu) {
          return 1;
        }


        if (
          d.name ===
          currentDong
        ) {
          return 1;
        }


        if (
          d.name ===
          nextDong
        ) {
          return 1;
        }


        if (
          completedDongs.includes(
            d.name
          )
        ) {
          return 0.7;
        }


        return 0;

      }
    )


    .attr(
  "font-size",
  d => {

    // 성동구, 서초구처럼
    // 모든 지역명이 보이는 구
    // → 무조건 같은 크기
    if (!isDenseGu) {
      return labelFontSize;
    }

    // 종로구처럼 복잡한 구만
    // 현재 지역 크게
    if (
      d.name === currentDong
    ) {
      return labelFontSize + 4;
    }

    // 다음 지역은 현재보다 조금 작게
    if (
      d.name === nextDong
    ) {
      return labelFontSize + 1;
    }

    // 완료 지역 작게
    if (
      completedDongs.includes(
        d.name
      )
    ) {
      return Math.max(
        5,
        labelFontSize - 5
      );
    }

    return labelFontSize;
  }
)


    .attr(
      "font-weight",
      d => {

        if (
          d.name ===
          currentDong
        ) {
          return 800;
        }


        if (
          d.name ===
          nextDong
        ) {
          return 750;
        }


        if (
          completedDongs.includes(
            d.name
          )
        ) {
          return 600;
        }


        return 500;

      }
    )


    .attr(
      "fill",
      d => {

        if (
          d.name ===
          currentDong
        ) {
          return "#111827";
        }


        if (
          d.name ===
          nextDong
        ) {
          return "#5F6875";
        }


        if (
          completedDongs.includes(
            d.name
          )
        ) {
          return "#4B7665";
        }


        return "#6B7280";

      }
    )

.text(d => d.name);
}

async function saveTourRecord(
  finalTime,
  finalSpeed,
  finalAccuracy
) {

  const {
    data: { user },
    error: userError
  } =
    await supabase.auth.getUser();


  if (
    userError ||
    !user
  ) {
    console.log(
      "비로그인 상태이므로 기록을 저장하지 않습니다."
    );

    return;
  }


  /*
    첫 타자 때 시작한
    서버 세션 생성이 아직 진행 중이면 기다림
  */

  if (
    !currentGameSessionId &&
    currentGameSessionPromise
  ) {
    await currentGameSessionPromise;
  }


  if (!currentGameSessionId) {
    console.error(
      "서울 종주 세션을 찾을 수 없습니다."
    );

    return;
  }


  const {
    data,
    error
  } =
    await supabase.functions.invoke(
      "save-game-record",
      {
        body: {

          session_id:
            currentGameSessionId,

          mode:
            "tour",

          target_region:
            "서울특별시",

          time_seconds:
            finalTime,

          typing_speed:
            finalSpeed,

          accuracy:
            finalAccuracy,

          mistakes:
            tourAccuracyWrong
        }
      }
    );


  if (
    error ||
    !data?.success
  ) {
    console.error(
      "서울 종주 기록 저장 실패:",
      error ||
      data?.error
    );

    return;
  }


  console.log(
    "서울 종주 기록 저장 성공!"
  );
}

async function saveGuRecord(
  guName,
  finalTime,
  finalSpeed,
  finalAccuracy,
  mistakes = 0
) {

  const {
    data: { user },
    error: userError
  } =
    await supabase.auth.getUser();


  if (
    userError ||
    !user
  ) {
    console.log(
      "비로그인 상태이므로 기록을 저장하지 않습니다."
    );

    return;
  }


  /*
    첫 타자 때 시작한
    서버 세션 생성이 아직 진행 중이면 기다림
  */

  if (
    !currentGameSessionId &&
    currentGameSessionPromise
  ) {
    await currentGameSessionPromise;
  }


  if (!currentGameSessionId) {
    console.error(
      "지역 게임 세션을 찾을 수 없습니다."
    );

    return;
  }


  const {
    data,
    error
  } =
    await supabase.functions.invoke(
      "save-game-record",
      {
        body: {

          session_id:
            currentGameSessionId,

          mode:
            "region",

          target_region:
            guName,

          time_seconds:
            finalTime,

          typing_speed:
            finalSpeed,

          accuracy:
            finalAccuracy,

          mistakes:
            mistakes
        }
      }
    );


  if (
    error ||
    !data?.success
  ) {
    console.error(
      "지역 기록 저장 실패:",
      error ||
      data?.error
    );

    return;
  }


  console.log(
    `${guName} 기록 저장 성공!`
  );
}

async function showTourResultScreen(
  finalTime,
  finalSpeed,
  finalAccuracy
) {

  /* =========================================
     서울 종주 완료 효과음
  ========================================== */

  playSoundEffect("tour");


  /* =========================================
     로그인 확인
  ========================================== */

  const {
    data: { user }
  } =
    await supabase.auth.getUser();



  /* =========================================
     결과 화면
  ========================================== */

  app.innerHTML = `
    <main class="tour-result-screen tour-result-screen-v2">

      <section class="tour-result-card tour-result-card-v2">


        <!-- 완료 아이콘 -->

        <div class="tour-result-icon">
          ✓
        </div>


        <p class="tour-result-label">
          SEOUL COMPLETE
        </p>


        <h1>
          서울 종주 완료!
        </h1>


        <p class="tour-result-subtitle">
          서울 25개 구를 모두 완주했습니다.
        </p>



        <!-- =====================================
             메인 기록
        ====================================== -->

        <div class="tour-result-main-record">

          <span>
            평균 타수
          </span>

          <strong>
            ${finalSpeed}
            <small>타</small>
          </strong>

        </div>



        <!-- =====================================
             상세 기록
        ====================================== -->

        <div class="tour-result-stats">


          <div class="tour-result-stat">

            <span>
              완료 지역
            </span>

            <strong>
              25개 구
            </strong>

          </div>


          <div class="tour-result-stat">

            <span>
              총 시간
            </span>

            <strong>
              ${finalTime.toFixed(1)}초
            </strong>

          </div>


          <div class="tour-result-stat">

            <span>
              정확도
            </span>

            <strong>
              ${finalAccuracy}%
            </strong>

          </div>


        </div>



        <!-- =====================================
             로그인 상태
        ====================================== -->

        ${
          user
            ? `
              <button
                id="tour-result-ranking-button"
                class="tour-result-ranking-button"
                type="button"
              >

                <span>
                  서울 종주 랭킹 보기
                </span>

                <span class="tour-result-ranking-arrow">
                  →
                </span>

              </button>
            `
            : `
              <div class="result-login-cta">

                <strong>
                  완주 기록을 랭킹에 남겨보세요.
                </strong>

                <p>
                  로그인하면 다음 서울 종주부터 기록이 저장되고
                  다른 플레이어와 순위를 비교할 수 있어요.
                </p>

                <button
                  id="tour-result-login-button"
                  type="button"
                >
                  로그인하고 랭킹 참여하기
                </button>

              </div>
            `
        }



        <!-- =====================================
             하단 버튼
        ====================================== -->

        <div class="tour-result-buttons tour-result-buttons-v2">


          <button
            id="tour-retry-button"
            class="tour-result-retry"
            type="button"
          >
            다시 도전
          </button>


          <button
            id="tour-home-button"
            class="tour-result-home"
            type="button"
          >
            홈으로
          </button>


        </div>


      </section>

    </main>
  `;



  /* =========================================
     다시 도전
  ========================================== */

  document
    .querySelector(
      "#tour-retry-button"
    )
    ?.addEventListener(
      "click",
      async () => {

        gameMode =
          "tour";

        tourGuIndex =
          0;

        tourResults =
          [];

        tourStartTime =
          null;

        tourKeyStrokeCount =
          0;

        tourAccuracyCorrect =
          0;

        tourAccuracyWrong =
          0;

        tourCompletedDongCount =
          0;



        /* 전체 동 개수 다시 계산 */

        const allDongLists =
          await Promise.all(

            seoulGuOrder.map(
              guName =>
                getDongsForGu(
                  guName
                )
            )

          );


        tourTotalDongCount =
          allDongLists.reduce(
            (
              total,
              dongs
            ) =>
              total +
              dongs.length,
            0
          );


        showTourCountdownScreen();

      }
    );



  /* =========================================
     홈으로
  ========================================== */

  document
    .querySelector(
      "#tour-home-button"
    )
    ?.addEventListener(
      "click",
      () => {

        gameMode =
          "region";

        showHomeScreen();

      }
    );



  /* =========================================
     로그인 사용자
     → 서울 종주 랭킹
  ========================================== */

  if (user) {

    document
      .querySelector(
        "#tour-result-ranking-button"
      )
      ?.addEventListener(
        "click",
        async () => {

          /*
            랭킹 화면 생성
          */

          await showRankingScreen();


          /*
            왼쪽 패널을
            서울 종주 랭킹으로 표시
          */

          await showTourRankingPanel();

        }
      );

  }



  /* =========================================
     비로그인 사용자
  ========================================== */

  if (!user) {

    document
      .querySelector(
        "#tour-result-login-button"
      )
      ?.addEventListener(
        "click",
        () => {

          showAuthScreen();

        }
      );

  }

}

async function showGuResultScreen(
  guName,
  completedCount,
  finalTime,
  finalSpeed,
  accuracy
) {

  /* 지역 완료 효과음 */
  playSoundEffect("tour");


  /* 로그인 여부 확인 */

  const {
    data: { user }
  } =
    await supabase.auth.getUser();



  /* =========================================
     결과 화면
  ========================================== */

  app.innerHTML = `
    <main class="gu-result-screen gu-result-screen-v2">

      <section class="gu-result-card gu-result-card-v2">


        <!-- 완료 아이콘 -->

        <div class="gu-result-icon">
          ✓
        </div>


        <p class="gu-result-label">
          REGION COMPLETE
        </p>


        <h1>
          ${guName} 완료!
        </h1>


        <p class="gu-result-subtitle">
          ${guName}의 모든 지역을 타이핑했습니다.
        </p>



        <!-- =====================================
             메인 기록
        ====================================== -->

        <div class="gu-result-main-record">

          <span>
            평균 타수
          </span>

          <strong>
            ${finalSpeed}
            <small>타</small>
          </strong>

        </div>



        <!-- =====================================
             상세 기록
        ====================================== -->

        <div class="gu-result-stats">

          <div class="gu-result-stat">

            <span>
              완료 지역
            </span>

            <strong>
              ${completedCount}개
            </strong>

          </div>


          <div class="gu-result-stat">

            <span>
              시간
            </span>

            <strong>
              ${finalTime.toFixed(1)}초
            </strong>

          </div>


          <div class="gu-result-stat">

            <span>
              정확도
            </span>

            <strong>
              ${accuracy}%
            </strong>

          </div>

        </div>



        <!-- =====================================
             로그인 여부에 따른 영역
        ====================================== -->

        ${
          user
            ? `
              <button
                id="result-ranking-button"
                class="gu-result-ranking-button"
                type="button"
              >
                <span>
                  ${guName} 랭킹 보기
                </span>

                <span class="gu-result-ranking-arrow">
                  →
                </span>
              </button>
            `
            : `
              <div class="result-login-cta">

                <strong>
                  이 기록을 랭킹에 남기고 싶나요?
                </strong>

                <p>
                  로그인하면 다음 플레이부터 기록이 저장되고
                  서울 타이핑 랭킹에 참여할 수 있어요.
                </p>

                <button
                  id="result-login-button"
                  type="button"
                >
                  로그인하고 랭킹 참여하기
                </button>

              </div>
            `
        }



        <!-- =====================================
             하단 버튼
        ====================================== -->

        <div class="gu-result-buttons gu-result-buttons-v2">


          <button
            id="retry-button"
            class="gu-result-retry"
            type="button"
          >
            다시 도전
          </button>


          <button
            id="map-button"
            class="gu-result-map"
            type="button"
          >
            다른 지역
          </button>


          <button
            id="result-home-button"
            class="gu-result-home-button"
            type="button"
          >
            홈으로
          </button>


        </div>

      </section>

    </main>
  `;



  /* =========================================
     다시 도전
  ========================================== */

  document
    .querySelector(
      "#retry-button"
    )
    ?.addEventListener(
      "click",
      () => {

        gameMode =
          "region";

        showTypingScreen(
          guName
        );

      }
    );



  /* =========================================
     다른 지역
  ========================================== */

  document
    .querySelector(
      "#map-button"
    )
    ?.addEventListener(
      "click",
      () => {

        gameMode =
          "region";

        showSeoulMapScreen();

      }
    );



  /* =========================================
     홈으로
  ========================================== */

  document
    .querySelector(
      "#result-home-button"
    )
    ?.addEventListener(
      "click",
      () => {

        gameMode =
          null;

        showHomeScreen();

      }
    );



  /* =========================================
     로그인 사용자
     → 방금 플레이한 구 랭킹으로 바로 이동
  ========================================== */

  if (user) {

    document
      .querySelector(
        "#result-ranking-button"
      )
      ?.addEventListener(
        "click",
        async () => {

          /*
            먼저 랭킹 화면을 완전히 생성
          */

          await showRankingScreen();


          /*
            방금 플레이한 구를
            지도에서 선택된 상태로 표시하고,
            오른쪽에 해당 구 랭킹 표시
          */

          await Promise.all([

            drawRankingSeoulMap(
              guName
            ),

            showGuRankingPanel(
              guName
            )

          ]);

        }
      );

  }



  /* =========================================
     비로그인 사용자
  ========================================== */

  if (!user) {

    document
      .querySelector(
        "#result-login-button"
      )
      ?.addEventListener(
        "click",
        () => {

          showAuthScreen();

        }
      );

  }

}

/* =========================================================
   GLOBAL ESC NAVIGATION
   모든 화면에서 Esc = 뒤로가기
========================================================= */

document.addEventListener("keydown", event => {

  if (event.key !== "Escape") {
    return;
  }

    /* =========================================
     랭킹 모달이 열려 있으면
     Esc = 모달만 닫기
  ========================================= */

  const rankingModal =
    document.querySelector(
      "#ranking-modal"
    );

  if (
    rankingModal &&
    !rankingModal.classList.contains(
      "is-hidden"
    )
  ) {
    closeRankingModal();
    return;
  }


  // 서울 종주 카운트다운
  const tourCountdownBack =
    document.querySelector(
      "#tour-countdown-back-button"
    );

  if (tourCountdownBack) {
    tourCountdownBack.click();
    return;
  }


  // 타자 플레이 화면
  const typingBack =
    document.querySelector(
      "#typing-back-button"
    );

  if (typingBack) {
    typingBack.click();
    return;
  }


  // 일반 지역 시작 화면
  const guStartBack =
    document.querySelector(
      "#back-button"
    );

  if (guStartBack) {
    guStartBack.click();
    return;
  }

  // 내 기록 화면
  const myRecordsBack =
    document.querySelector(
      "#my-records-back-button"
    );

  if (myRecordsBack) {
    myRecordsBack.click();
    return;
  }

  // 설정 화면
const settingsBack =
  document.querySelector(
    "#settings-back-button"
  );

if (settingsBack) {
  settingsBack.click();
  return;
}

  // 랭킹 화면
  const rankingBack =
    document.querySelector(
      "#ranking-back-button"
    );

  if (rankingBack) {
    rankingBack.click();
    return;
  }


  // 지역 선택 서울 지도
  const mapHome =
    document.querySelector(
      "#home-button"
    );

  if (mapHome) {
    mapHome.click();
    return;
  }


  // 서울 종주 결과
  const tourResultHome =
    document.querySelector(
      "#tour-home-button"
    );

  if (tourResultHome) {
    tourResultHome.click();
    return;
  }


  // 일반 지역 결과
  const guResultMap =
    document.querySelector(
      "#map-button"
    );

  if (guResultMap) {
    guResultMap.click();
    return;
  }

});

/* =========================================================
   BROWSER BACK BUTTON GUARD
   브라우저 ← 버튼 = 서울 타이핑 홈
========================================================= */

function setupBrowserBackButton() {

  /*
    현재 페이지를 기준점으로 만들고
    같은 페이지의 가짜 history 한 칸을 추가한다.
  */

  if (
    !window.history.state?.seoulTypingGuard
  ) {

    window.history.replaceState(
      {
        seoulTypingBase: true
      },
      "",
      window.location.href
    );

    window.history.pushState(
      {
        seoulTypingGuard: true
      },
      "",
      window.location.href
    );

  }


  window.addEventListener(
    "popstate",
    () => {

      /*
        크롬 ← 버튼을 눌러도
        사이트 밖으로 보내지 않고 홈 화면 표시
      */

      showHomeScreen();


      /*
        다시 뒤로가기 방어막 생성
      */

      window.history.pushState(
        {
          seoulTypingGuard: true
        },
        "",
        window.location.href
      );

    }
  );

}

setupBrowserBackButton();
showHomeScreen();