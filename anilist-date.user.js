// ==UserScript==
// @name         AniList Date
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Enregistre la date du dernier visionnage / revisionnage sur une base de donne supabase
// @author       Symswag
// @match        *://*.crunchyroll.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // 🔧 1. CONFIGURATION GÉNÉRALE
    // ==========================================
    const TARGET_USERNAME = 'USERNAME';
    const TRIGGER_PERCENTAGE = 95;

    const SUPABASE_URL = 'SUPABASE_URL';
    const SUPABASE_ANON_KEY = 'SUPABASE_ANON_KEY';
    const TABLE_NAME = 'anime_history';

    const PROGRESS_COLOR = "#00FFFF";
    const FINISH_COLOR = "#3ECF8E";

    // ==========================================
    // 🌍 2. SITES SUPPORTÉS (Système Universel)
    // ==========================================
    const SUPPORTED_SITES = [
        {
            name: 'Crunchyroll',
            domain: 'crunchyroll.com',
            videoSelector: 'video'
        }
    ];

    // ==========================================
    // 🎨 3. STYLES CSS (Basés sur vos classes)
    // ==========================================
    const style = document.createElement('style');
    style.innerHTML = `
        #ad-countdown-overlay {
            position: absolute;
            top: 20px;
            right: 20px;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: rgba(14, 15, 18, 0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1001;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.6);
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.2s ease, transform 0.2s ease, visibility 0.2s;
            transform: scale(0.8);
            pointer-events: none;
        }
        #ad-countdown-overlay.ad-show {
            opacity: 1;
            visibility: visible;
            transform: scale(1);
        }
        .ad-spinner {
            position: absolute;
            width: 100%;
            height: 100%;
            transform: rotate(-90deg);
        }
        .ad-spinner-bg {
            fill: none;
            stroke: rgba(255,255,255,0.1);
            stroke-width: 4;
        }
        .ad-spinner-progress {
            fill: none;
            stroke: #00ffff;
            stroke-width: 4;
            stroke-linecap: round;
            stroke-dasharray: 126;
            stroke-dashoffset: 0;
            transition: stroke-dashoffset 0.2s linear;
        }
        #ad-countdown-number {
            color: #00ffff;
            font-size: 18px;
            font-weight: bold;
            font-family: "Segoe UI", Roboto, sans-serif;
            z-index: 2;
        }
    `;
    document.head.appendChild(style);

    // ==========================================
    // 🛠️ 4. FONCTION SPINNER ET COMPTEUR
    // ==========================================
    function showSpinnerAndSync(videoElement) {
        // S'assurer qu'il n'y a pas doublon
        let cd = document.getElementById('ad-countdown-overlay');
        if (!cd) {
            cd = document.createElement('div');
            cd.id = 'ad-countdown-overlay';
            cd.innerHTML = `
                <svg class="ad-spinner" viewBox="0 0 50 50">
                    <circle class="ad-spinner-bg" cx="25" cy="25" r="20"></circle>
                    <circle class="ad-spinner-progress" cx="25" cy="25" r="20"></circle>
                </svg>
                <span id="ad-countdown-number">5</span>
            `;

            // Injection dans le conteneur vidéo ou la zone parente
            const videoWrapper = videoElement.closest('[data-testid="vilos-player"]') || videoElement.parentNode;
            videoWrapper.appendChild(cd);
        }

        const progressCircle = cd.querySelector('.ad-spinner-progress');
        const countdownSpan = cd.querySelector('#ad-countdown-number');
        const totalLength = 126; // Correspond au stroke-dasharray
        let timeLeft = 5;

        // Réinitialiser l'affichage et lancer l'animation d'apparition
        countdownSpan.innerText = timeLeft;
        countdownSpan.style.color = PROGRESS_COLOR;
        progressCircle.style.stroke = PROGRESS_COLOR;
        progressCircle.style.strokeDashoffset = 0;
        cd.classList.add('ad-show');

        // Boucle du compte à rebours (chaque seconde)
        const interval = setInterval(() => {
            timeLeft--;

            if (timeLeft > 0) {
                countdownSpan.innerText = timeLeft;
                // Calcul du décalage (remplissage progressif du cercle sur 5 secondes)
                const offset = totalLength * (1 - timeLeft / 5);
                progressCircle.style.strokeDashoffset = offset;
            } else {
                clearInterval(interval);
                countdownSpan.innerText = "✓";
                countdownSpan.style.color = FINISH_COLOR;
                progressCircle.style.strokeDashoffset = 0;
                progressCircle.style.stroke = FINISH_COLOR; // Vert de succès

                // Synchronisation Supabase
                syncAniListToSupabase();

                // Masquer le widget après 2 secondes
                setTimeout(() => {
                    cd.classList.remove('ad-show');
                }, 2000);
            }
        }, 1000);
    }

    // ==========================================
    // 🔄 5. LOGIQUE DE SYNCHRONISATION
    // ==========================================
    async function syncAniListToSupabase() {
        if (!SUPABASE_URL || SUPABASE_URL.includes('VOTRE_SUPABASE')) {
            console.error("❌ Supabase non configuré.");
            return;
        }

        try {
            // 1. ID AniList
            const userQuery = `query ($name: String) { User(name: $name) { id } }`;
            const userRes = await fetch('https://graphql.anilist.co', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ query: userQuery, variables: { name: TARGET_USERNAME } })
            });
            const userData = await userRes.json();
            const userId = userData.data.User.id;

            // 2. Activités
            const activityQuery = `
                query ($userId: Int) {
                  Page(page: 1, perPage: 15) {
                    activities(userId: $userId, type: MEDIA_LIST, sort: ID_DESC) {
                      ... on ListActivity {
                        status
                        createdAt
                        media { id }
                      }
                    }
                  }
                }
            `;
            const activityRes = await fetch('https://graphql.anilist.co', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ query: activityQuery, variables: { userId: userId } })
            });
            const activityData = await activityRes.json();
            const activities = activityData.data.Page.activities;

            // 3. Filtrage (Uniquement completed / rewatched)
            const filteredActivities = activities.filter(act =>
                act.status === 'completed' || act.status === 'rewatched'
            );

            if (filteredActivities.length === 0) {
                console.log("ℹ️ AniList check: Aucun anime terminé récemment.");
                return;
            }

            // 4. VÉRIFICATION DANS SUPABASE : Récupérer les dates actuelles
            const mediaIds = filteredActivities.map(act => act.media.id).join(',');
            let existingData = [];

            const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE_NAME}?media_id=in.(${mediaIds})&select=media_id,completed_at`, {
                method: 'GET',
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                }
            });

            if (checkRes.ok) {
                existingData = await checkRes.json();
            }

            // Création d'un dictionnaire pour un accès rapide aux dates existantes (en millisecondes)
            const existingDatesMap = {};
            existingData.forEach(row => {
                existingDatesMap[row.media_id] = new Date(row.completed_at).getTime();
            });

            // 5. Comparaison des dates et préparation du payload final
            const supabasePayload = [];
            filteredActivities.forEach(act => {
                const newDateObj = new Date(act.createdAt * 1000);
                const newTime = newDateObj.getTime();
                const existingTime = existingDatesMap[act.media.id];

                // On ajoute au payload SEULEMENT SI :
                // - L'anime n'est pas encore dans Supabase (!existingTime)
                // - OU la nouvelle date AniList est strictement supérieure à celle de Supabase (newTime > existingTime)
                if (!existingTime || newTime > existingTime) {
                    supabasePayload.push({
                        media_id: act.media.id,
                        completed_at: newDateObj.toISOString()
                    });
                }
            });

            // Si aucune nouvelle date n'est plus récente, on annule l'envoi
            if (supabasePayload.length === 0) {
                console.log("ℹ️ Supabase check: Les dates dans la base sont déjà à jour, rien à envoyer.");
                return;
            }

            // 6. Upsert Supabase (uniquement avec les données filtrées plus récentes)
            const supabaseRes = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE_NAME}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                    'Prefer': 'resolution=merge-duplicates'
                },
                body: JSON.stringify(supabasePayload)
            });

            if (!supabaseRes.ok) throw new Error('Erreur Supabase');

            console.log("✅ Supabase Sync OK (Dates mises à jour) :", supabasePayload);

        } catch (error) {
            console.error("❌ Erreur de synchronisation :", error);
        }
    }

    // ==========================================
    // 🎬 6. WATCHER DE VIDÉO
    // ==========================================
    function initVideoWatcher(siteConfig) {
        let hasTriggeredForThisEpisode = false;

        console.log(`👁️ Script activé pour ${siteConfig.name}. En attente du lecteur vidéo...`);

        const observer = new MutationObserver(() => {
            const video = document.querySelector(siteConfig.videoSelector);

            if (video && !video.dataset.syncAttached) {
                video.dataset.syncAttached = "true";
                console.log("📺 Lecteur vidéo détecté ! Tracker attaché.");

                video.addEventListener('loadeddata', () => {
                    hasTriggeredForThisEpisode = false;
                });

                video.addEventListener('timeupdate', () => {
                    if (hasTriggeredForThisEpisode || !video.duration) return;

                    const progress = (video.currentTime / video.duration) * 100;

                    if (progress >= TRIGGER_PERCENTAGE) {
                        hasTriggeredForThisEpisode = true;

                        // Déclenche l'affichage du spinner en passant le lecteur vidéo
                        showSpinnerAndSync(video);
                    }
                });
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ==========================================
    // 🚀 7. DÉMARRAGE DU SCRIPT
    // ==========================================
    const currentDomain = window.location.hostname;
    const matchedSite = SUPPORTED_SITES.find(site => currentDomain.includes(site.domain));

    if (matchedSite) {
        initVideoWatcher(matchedSite);
    }
})();