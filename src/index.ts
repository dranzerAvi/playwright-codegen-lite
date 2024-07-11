import axios from 'axios';
import { Frame, chromium } from "playwright";
import type { Action, ActionInContext, FrameDescription } from "./types";
import { rewriteLines } from "./utils";
import { CodeGenerator } from "./vendor/codeGeneratorBundle";
import * as injectedScriptSource from "./vendor/generated/injectedScriptSource";
import * as recorderSource from "./vendor/generated/recorderSource";
import { JavaScriptLanguageGenerator } from "./vendor/javascriptBundle";
import fs from 'fs';
import path from 'path';


const browserUrl = process.argv[2] || "https://demo.playwright.dev/todomvc";
const outputDir = 'generated-scripts';
const outputFileName = process.argv[3] || "generated_script.js";
const outputFilePath = path.join(outputDir, outputFileName);
let generatedCode = '';

const apiEndpoint = "https://staging.flyingraccoon.tech/sdk/event/log";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  const page = await context.newPage();
  await page.goto(browserUrl);

  const generator = new CodeGenerator(
    "chromium",
    true,
    {},
    {},
    undefined,
    undefined
  );

  async function describeFrame(frame: Frame): Promise<FrameDescription> {
    const page = frame.page;
    const pageAlias = page.name;
    const chain: Frame[] = [];
    for (
      let ancestor: Frame | null = frame;
      ancestor;
      ancestor = ancestor.parentFrame()
    )
      chain.push(ancestor);
    chain.reverse();
    return {
      isMainFrame: true,
      pageAlias,
      url: frame.url(),
    };
  }

  generator.addAction({
    frame: {
      isMainFrame: true,
      pageAlias: "page",
      url: page.mainFrame().url(),
    },
    committed: true,
    action: {
      name: "openPage",
      url: page.mainFrame().url(),
      signals: [],
    },
  });

  // TODO
  // function onPage(page: Page) {}

  const languageGenerator = new JavaScriptLanguageGenerator();

  async function recordAction(frame: Frame, action: Action) {
    generator.commitLastAction();
    const frameDescription = await describeFrame(frame);
    const actionInContext: ActionInContext = {
      frame: frameDescription,
      action,
    };
    generator.addAction(actionInContext);
    const output = generator.generateStructure(languageGenerator as any).text;
    rewriteLines(output.split("\n"));
    generatedCode = output;

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write the generated code to the file
    fs.writeFileSync(outputFilePath, generatedCode, 'utf8');
  }

  await context.exposeBinding(
    "__pw_recorderPerformAction",
    async (source, action) => {
      await recordAction(source.frame, action);
    }
  );
  await context.exposeBinding(
    "__pw_recorderRecordAction",
    async (source, action) => {
      await recordAction(source.frame, action);
    }
  );
  // useless bindings below
  await context.exposeBinding("__pw_recorderSetSelector", () => {});
  await context.exposeBinding("__pw_recorderState", () => {});
  await context.exposeBinding("__pw_refreshOverlay", () => {});

  async function injectScript(source: string, name: string) {
    const content = `(() => {
      const module = {};
      ${source}
      globalThis.${name} = module.exports;
    })()`;
    return await page.addScriptTag({ content });
  }

  async function injectScripts() {
    await injectScript(injectedScriptSource.source, "__InjectedScript");
    await injectScript(recorderSource.source, "__Recorder");

    await page.addScriptTag({
      content: `!globalThis.__injectedScript && (globalThis.__injectedScript = new globalThis.__InjectedScript(true, "javascript", "idk", 0, "chromium", []));
      !globalThis.__recorder && (globalThis.__recorder = new globalThis.__Recorder(globalThis.__injectedScript));`,
    });
  }

  await injectScripts();
  // TODO: use onPage function to also add an action for the code generator
  page.on("framenavigated", injectScripts);
  process.on('SIGINT', async () => {
    await handleExit();
  });
  
  process.on('SIGTERM', async () => {
    await handleExit();
  });
  
  process.on('exit', async (code) => {
    await handleExit();
    console.log(`Process exited with code: ${code}`);
  });
  
  async function handleExit() {
    console.log('Handling process exit...');
  
    const requestBodyData = {
      eventName: "TASK_SUCCESS",    
      taskId: generatedCode,
      journeyId: "",
      InTargetGroup: true
    };
  
    try {
      console.log('Attempting to call API...');
      await axios.post(apiEndpoint, requestBodyData, {
        headers: {
          'secret-key': 'S2JhNDA2MWUtZjU0MS00MzMyLWExN2ItMjI3YmNjMzdlOTAy',
          'user-id': 'raccoon',
          'sdk': '0.0.4',
          'platform': 'Android',
          'app-version': '1.0',
          'android-version': '1.1.1'
        }
      });
      console.log('Script saved successfully');
    } catch (error) {
      console.error('Failed to save script:', error);
    }
  
    console.log('Generated Code:\n', generatedCode);
  }
}

main();