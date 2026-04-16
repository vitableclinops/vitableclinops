/**
 * Typed Homebase API client for Deno edge functions.
 *
 * Base URL : https://app.joinhomebase.com/api/public
 * Auth     : Authorization: Bearer <HOMEBASE_API_KEY>
 * Accept   : application/json
 */

const BASE_URL = 'https://app.joinhomebase.com/api/public';

export interface HBLocation {
  uuid: string;
  name: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;   // 2-letter
  zip: string;
  country_code: string;
  time_zone: string;
  created_at: string;
  updated_at: string;
}

export interface HBEmployeeJob {
  id: number;
  level: string;
  default_role: string;
  payroll_id: string;
  wage_rate: number;
  wage_type: string;
  roles: { name: string; wage_rate: number }[];
  archived_at: string | null;
  location_uuid: string;
}

export interface HBEmployee {
  id: number;          // integer, stable Homebase ID
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  job: HBEmployeeJob;
  created_at: string;
  updated_at: string;
}

export interface HBShiftLabor {
  wage_type: string;
  scheduled_hours: number;
  scheduled_overtime: number;
  scheduled_regular: number;
  scheduled_costs: number;
}

export interface HBShift {
  id: number;
  timecard_id: number | null;
  open: boolean;
  role: string;
  department: string;
  first_name: string;
  last_name: string;
  location_id: number;
  job_id: number;
  user_id: number;     // maps to HBEmployee.id
  published: boolean;
  scheduled: boolean;
  labor: HBShiftLabor;
  start_at: string;    // ISO 8601
  end_at: string;
  note?: { text: string; author: string } | null;
  created_at: string;
  updated_at: string;
}

export class HomebaseClient {
  private readonly headers: HeadersInit;

  constructor(apiKey: string) {
    this.headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    };
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Homebase API error ${res.status} for ${path}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  /** Fetch all locations for this account. */
  async listLocations(): Promise<HBLocation[]> {
    return this.get<HBLocation[]>('/locations');
  }

  /**
   * Paginate through all employees for a location.
   * Stops when a page returns fewer rows than per_page.
   */
  async *iterateEmployees(
    locationUuid: string,
    { withArchived = false, perPage = 100 } = {}
  ): AsyncGenerator<HBEmployee> {
    let page = 1;
    while (true) {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        with_archived: String(withArchived),
      });
      const batch = await this.get<HBEmployee[]>(
        `/locations/${locationUuid}/employees?${params}`
      );
      for (const emp of batch) yield emp;
      if (batch.length < perPage) break;
      page++;
    }
  }

  /**
   * Paginate through shifts for a location within a date window.
   * Uses start_date / end_date query params (YYYY-MM-DD).
   */
  async *iterateShifts(
    locationUuid: string,
    startDate: string,
    endDate: string,
    { perPage = 100 } = {}
  ): AsyncGenerator<HBShift> {
    let page = 1;
    while (true) {
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
        page: String(page),
        per_page: String(perPage),
      });
      const batch = await this.get<HBShift[]>(
        `/locations/${locationUuid}/shifts?${params}`
      );
      
      for (const shift of batch) yield shift;
      if (batch.length < perPage) break;
      page++;
    }
  }
}
