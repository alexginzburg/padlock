import { CloudSource } from "./source";
import { Settings } from "./data";
import { getAppVersion } from "./platform";
import { get as getStats, set as setStats } from "./stats";

let initCb: () => void;
let cloudSource: CloudSource;
let trackingID = "";

const initialized = new Promise((resolve) => initCb = resolve);

export function init(settings: Settings) {
    cloudSource = new CloudSource(settings);
    initCb();
}

export function setTrackingID(id: string) {
    trackingID = id;
    return setStats({ trackingID: id });
}

let ready = Promise.all([
    getStats(),
    getAppVersion(),
    initialized
])
    .then(([stats, version]) => {
        trackingID = stats.trackingID as string;
        const launchCount = typeof stats.launchCount === "number" ? (stats.launchCount as number)+ 1 : 1;
        const isFirstLaunch = !stats.firstLaunch;
        const firstLaunch = stats.firstLaunch || new Date().getTime();

        if (isFirstLaunch) {
            track("Install");
        } else if (stats.lastVersion !== version) {
            track("Update", { "From Version": stats.lastVersion });
        }

        return setStats({
            firstLaunch: firstLaunch,
            lastLaunch: new Date().getTime(),
            launchCount: launchCount,
            lastVersion: version
        });
    });

let lastTrack: Promise<any> = ready;
export function track(event: string, props?: { [prop: string]: number|string }) {
    // Don't track events if user is using a custom padlock cloud instance
    if (cloudSource.settings.syncCustomHost) {
        return Promise.resolve();
    }

    const data = {
        event: event,
        props: props || {},
        trackingID: trackingID
    };

    if (data.props.Email) {
        ready = setStats({ "email": data.props.Email });
    }

    ready = ready.then(() => getStats())
        .then((stats) => {
            Object.assign(data.props, {
                "First Launch": stats.firstLaunch && new Date(stats.firstLaunch as number).toISOString(),
                "Launch Count": stats.launchCount,
                "Custom Server": stats.syncCustomHost || false,
                "Email": stats.email
            });

            if (stats.lastSync) {
                data.props["Last Sync"] = new Date(stats.lastSync as number).toISOString();
            }

            if (stats.lastAskedFeedback) {
                Object.assign(data.props, {
                    "Last Rated": new Date(stats.lastAskedFeedback as number).toISOString(),
                    "Rated Version": stats.lastRatedVersion,
                    "Rating": stats.lastRating
                });
            }

            if (stats.lastReviewed) {
                data.props["Last Reviewed"] = new Date(stats.lastReviewed as number).toISOString();
            }
        })
        .then(() => cloudSource.request(
            "POST",
            "https://cloud.padlock.io/track/",
            JSON.stringify(data)
        ))
        .then((r) => {
            const res = JSON.parse(r.responseText);
            return setTrackingID(res.trackingID);
        })
        .catch(() => {});

    return lastTrack;
}
