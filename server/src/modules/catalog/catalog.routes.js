/**
 * catalog.routes.js – Routes for /api/v1/movies
 */
import { Router } from 'express';
import { catalogController } from './catalog.controller.js';

const router = Router();

router.get('/', catalogController.getMovies);
router.get('/:id/shows', catalogController.getMovieShows);

export default router;
