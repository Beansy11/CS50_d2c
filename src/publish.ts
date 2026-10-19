// Publish: <name>-prod made again from <name>-dev.
//
// CS50 citation: The desktop app builder's Publish branches were removed from
// this file with Claude (Anthropic AI), at my direction, when
// that builder was taken out of this project.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

import * as fs from 'fs';
import * as path from 'path';
import { readProject } from './projectFormat';
import { buildSiteProd } from '../website-editor/src/siteProject';

/**
 * Publish a saved project. -prod is output: it is deleted and made again every
 * time. It holds only the site: no .draw2code/ folder, no Draw2Code state.
 * The project's label stays at <project>/.draw2code/project.d2c.
 */
export function buildProd(root: string): { prod: string; pages: string[]; files: string[] } {
    const project = readProject(root);
    if (!project) throw new Error(`${path.basename(root)} is not a project Draw2Code made`);
    const dev = path.join(root, project.dev);
    const prod = path.join(root, project.prod);
    if (!fs.existsSync(dev)) throw new Error(`${project.dev} is missing`);
    // Only ever the folder the label names, inside this project.
    if (path.dirname(prod) !== root) throw new Error('the published folder must be inside the project');
    fs.rmSync(prod, { recursive: true, force: true });
    return buildSiteProd(dev, prod, project.stylesheet ?? 'css/style.css', project.pageWidth);
}
