import { searchService } from "../../modules/search/search.service.js";
import type { RequestLike } from "../routes/index.js";
import { getIntQueryParam, getOptionalQueryParam, getRequiredQueryParam } from "../request.js";

export const searchController = {
  async searchInitiatives(req: RequestLike) {
    return searchService.searchInitiatives({
      query: getOptionalQueryParam(req.url, "q"),
      status: getOptionalQueryParam(req.url, "status"),
      chamber: getOptionalQueryParam(req.url, "chamber"),
      dateFrom: getOptionalQueryParam(req.url, "dateFrom"),
      dateTo: getOptionalQueryParam(req.url, "dateTo"),
      author: getOptionalQueryParam(req.url, "author"),
      commission: getOptionalQueryParam(req.url, "commission"),
      limit: getIntQueryParam(req.url, "limit", 10, { min: 1, max: 100 }),
      offset: getIntQueryParam(req.url, "offset", 0, { min: 0 })
    });
  },

  async searchByAuthor(req: RequestLike) {
    return searchService.searchByAuthor({
      query: getRequiredQueryParam(req.url, "q"),
      limit: getIntQueryParam(req.url, "limit", 20, { min: 1, max: 100 }),
      offset: getIntQueryParam(req.url, "offset", 0, { min: 0 })
    });
  },

  async searchByTopic(req: RequestLike) {
    return searchService.searchByTopic({
      query: getRequiredQueryParam(req.url, "q"),
      limit: getIntQueryParam(req.url, "limit", 10, { min: 1, max: 100 }),
      offset: getIntQueryParam(req.url, "offset", 0, { min: 0 })
    });
  }
};
