import { login } from "../auth.js";
import { HttpClient } from "../http.js";
import { type Assignment, parseAssignmentFiles, parseContainer, parseExerciseOverview, parseMemberships, parseOpencastSeries } from "./parse.js";
import type { CourseEntry, IliasItem } from "./types.js";

/** Logged-in ILIAS session that re-authenticates automatically when it expires. */
export class IliasClient {
  readonly http: HttpClient;

  constructor(baseUrl: string, private readonly username: string, private readonly password: string) {
    this.http = new HttpClient(baseUrl);
    this.http.onSessionExpired = () => this.login();
  }

  login(): Promise<void> {
    return login(this.http, this.username, this.password);
  }

  async courses(): Promise<CourseEntry[]> {
    const { html } = await this.http.getHtml("ilias.php?baseClass=ilDashboardGUI&cmd=show");
    return parseMemberships(html);
  }

  async children(refId: string): Promise<IliasItem[]> {
    const { html, url } = await this.http.getHtml(`ilias.php?baseClass=ilrepositorygui&ref_id=${refId}`);
    return parseContainer(html, url);
  }

  async opencastEpisodes(refId: string): Promise<IliasItem[]> {
    const { html, url } = await this.http.getHtml(
      `ilias.php?baseClass=ilObjPluginDispatchGUI&cmd=forward&ref_id=${refId}&forwardCmd=showSeries`,
    );
    return parseOpencastSeries(html, url);
  }

  async assignments(excRefId: string): Promise<Assignment[]> {
    const { html, url } = await this.http.getHtml(
      `ilias.php?baseClass=ilexercisehandlergui&cmdClass=ilObjExerciseGUI&cmd=showOverview&ref_id=${excRefId}&mode=all&from_overview=1`,
    );
    return parseExerciseOverview(html, url);
  }

  async assignmentFiles(excRefId: string, assignment: Assignment): Promise<IliasItem[]> {
    const { html, url } = await this.http.getHtml(assignment.url);
    return parseAssignmentFiles(html, url, `exc_${excRefId}_${assignment.assId}`);
  }
}
