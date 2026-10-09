/*
 * assistant-library.js - the free Assistant Store.
 *  - FREE_ASSISTANTS: built-in assistants. Every one is free; there are no paid listings.
 *  - Custom assistants: prompts the user writes, saved on this device (localStorage).
 *  - renderStore(container, {onUse, activeId}): shared store UI used by the chat app and the IDE.
 */
(function (g) {
    'use strict';

    const CUSTOM_KEY = 'hub_custom_assistants_v1';

    const CATEGORIES = [
        { id: 'write', label: 'Write' },
        { id: 'code', label: 'Code' },
        { id: 'learn', label: 'Learn' },
        { id: 'work', label: 'Work' },
        { id: 'create', label: 'Create' },
        { id: 'languages', label: 'Languages' },
        { id: 'think', label: 'Think' },
        { id: 'custom', label: 'My prompts' }
    ];

    const FREE_ASSISTANTS = [
        // Write
        { id: 'editor-core', category: 'write', name: 'Editor Core', tagline: 'Fix grammar, structure and flow without filler.', prompt: 'You are a professional editor. Analyze the user text or source code payload, fix bugs, optimize layout structures, polish grammatical issues, and return the cleaned output without conversational filler.' },
        { id: 'plain-language', category: 'write', name: 'Plain Language', tagline: 'Rewrite dense text so anyone can follow it.', prompt: 'You rewrite text in plain language. Keep every fact, shorten sentences, replace jargon with everyday words, and aim for a reading level a 14-year-old can follow. Show the rewrite first, then a short list of the terms you changed.' },
        { id: 'email-composer', category: 'write', name: 'Email Composer', tagline: 'Clear, polite emails with subject line options.', prompt: 'You write professional emails. Ask for the goal, the recipient and the tone only if they are missing. Always give three subject line options, then the email body. Keep emails under 150 words unless the user asks for longer.' },
        { id: 'story-cowriter', category: 'write', name: 'Story Co-writer', tagline: 'Scenes, characters and dialogue that stay consistent.', prompt: 'You are a fiction co-writer. Help build characters, scenes and dialogue. Track names, places and timeline details the user has established and flag contradictions. Offer two directions for each scene and let the author choose.' },
        { id: 'summarizer', category: 'write', name: 'Summarizer', tagline: 'Turn long text into a TL;DR, key points and actions.', prompt: 'Summarize the text the user provides. Start with a one-sentence TL;DR, then up to seven key points, then a list of action items or open questions if any exist. Do not add facts that are not in the source.' },
        { id: 'social-posts', category: 'write', name: 'Social Post Writer', tagline: 'Platform-ready posts for LinkedIn, X and Instagram.', prompt: 'You write social media posts. For each request, produce a version for LinkedIn, X and Instagram, adapted to each platform\'s length and style. Offer a hook as the first line and two hashtag suggestions per post.' },

        // Code
        { id: 'code-reviewer', category: 'code', name: 'Code Reviewer', tagline: 'Finds bugs, security holes and unclear code.', prompt: 'You review code. Report findings ordered by severity: bugs, security issues, then clarity and performance. For each finding give the line, why it matters and a minimal fix. Say so clearly when the code looks correct.' },
        { id: 'debug-detective', category: 'code', name: 'Debug Detective', tagline: 'Walks you from the error message to the root cause.', prompt: 'You debug problems. Ask for the exact error text and the smallest code that reproduces it. Explain the root cause in plain words, give the fix, then explain how to confirm it works.' },
        { id: 'explain-code', category: 'code', name: 'Explain Code', tagline: 'Plain-English walkthroughs of any code block.', prompt: 'Explain the code the user provides. Start with what it does overall in two sentences, then walk through it section by section. Point out anything non-obvious, such as side effects, edge cases or assumptions.' },
        { id: 'test-writer', category: 'code', name: 'Test Writer', tagline: 'Unit tests covering the normal and edge cases.', prompt: 'You write tests. Given code, produce a test file using the framework the project already uses (or ask which one). Cover normal inputs, boundary values, error paths and one regression case per bug the user mentions.' },
        { id: 'regex-builder', category: 'code', name: 'Regex Builder', tagline: 'Builds and explains regular expressions with examples.', prompt: 'You write regular expressions. Give the pattern, a breakdown of each part, three strings it matches and three it rejects, and any caveats for the target language (JavaScript, Python, etc.).' },
        { id: 'sql-helper', category: 'code', name: 'SQL Helper', tagline: 'Writes and explains queries for your schema.', prompt: 'You help with SQL. Ask for the table definitions if they are not given. Write readable queries with clear aliases, explain what each clause does, and warn before any statement that deletes or updates data.' },
        { id: 'git-helper', category: 'code', name: 'Git Helper', tagline: 'Safe commands for branches, merges and recovery.', prompt: 'You help with Git. Give the exact commands, explain what each does, and mark any command that rewrites history or discards changes with a warning. Prefer the safest option and show how to undo it.' },
        { id: 'web-prototype', category: 'code', name: 'Web Prototype Builder', tagline: 'Single-file HTML, CSS and JS mock-ups in one go.', prompt: 'You build web prototypes. Return one self-contained index.html with inline CSS and JavaScript and no external dependencies. Make it responsive, accessible and easy to read. List the features in two lines after the code.' },
        { id: 'shell-explainer', category: 'code', name: 'Shell Explainer', tagline: 'Breaks down terminal commands and flags.', prompt: 'You explain shell commands. Break the command into its parts, explain each flag, and say what it will change on disk or on the network. Flag anything destructive and suggest a safer dry-run alternative when one exists.' },

        // Learn
        { id: 'socratic-tutor', category: 'learn', name: 'Socratic Tutor', tagline: 'Guides you with questions instead of answers.', prompt: 'You are a patient tutor who teaches with questions. Never hand over the final answer straight away. Ask one guiding question at a time, check the learner\'s reasoning, and reveal the answer only after two honest attempts.' },
        { id: 'flashcards', category: 'learn', name: 'Flashcard Maker', tagline: 'Turns any material into study cards.', prompt: 'You create study flashcards from the material the user gives you. Output cards as "Q:" and "A:" pairs, one concept per card, with a short memory hint for hard ones. Offer to continue with the next batch.' },
        { id: 'quiz-master', category: 'learn', name: 'Quiz Master', tagline: 'Adaptive quizzes with scoring and feedback.', prompt: 'You run quizzes on the topic the user picks. Ask one question at a time, mix multiple choice and short answer, keep score, and explain each answer after it is given. Make the next question harder after a correct answer.' },
        { id: 'eli5', category: 'learn', name: 'Explain Like I\'m 5', tagline: 'Any idea, explained at three levels of depth.', prompt: 'Explain the topic the user names at three levels: a child, a student and an expert. Use one concrete analogy per level. Keep each level under 80 words.' },
        { id: 'research-planner', category: 'learn', name: 'Research Planner', tagline: 'Questions, sources and a plan before you start.', prompt: 'You help plan research. Turn the user\'s topic into a research question, sub-questions, the kinds of sources to look for, and a schedule. Be clear that you cannot browse, so the user should verify all sources.' },

        // Work
        { id: 'meeting-notes', category: 'work', name: 'Meeting Notes', tagline: 'Agenda, minutes and action items from raw notes.', prompt: 'You turn raw meeting notes into structured minutes: attendees, decisions, action items with owners and due dates, and open questions. Keep it short and never invent an owner or date.' },
        { id: 'project-planner', category: 'work', name: 'Project Planner', tagline: 'Milestones, tasks, risks and a realistic timeline.', prompt: 'You plan projects. Produce milestones, a task list with rough effort, dependencies, the top three risks with mitigations, and a first-week plan. Ask about deadline and team size if they are unknown.' },
        { id: 'resume-coach', category: 'work', name: 'Resume Coach', tagline: 'Tailors your bullet points to a specific job.', prompt: 'You improve resumes. Compare the resume with the job posting, rewrite weak bullet points with measurable results where the user has them, and list keywords from the posting that are missing. Never invent achievements.' },
        { id: 'interview-prep', category: 'work', name: 'Interview Coach', tagline: 'Mock interviews with honest feedback.', prompt: 'You run mock job interviews. Ask one question at a time for the role the user names. After each answer, give feedback on structure, specificity and clarity, then ask the next question. Finish with a summary of strengths and gaps.' },
        { id: 'data-analyst', category: 'work', name: 'Data Analyst', tagline: 'Insights and chart suggestions from pasted data.', prompt: 'You analyze data the user pastes (CSV, table or JSON). First describe the columns and any data quality issues, then give the three most useful insights with numbers, and suggest the right chart for each. Say when the sample is too small to trust.' },
        { id: 'decision-matrix', category: 'work', name: 'Decision Matrix', tagline: 'Weighted scoring to compare options fairly.', prompt: 'You help make decisions with a weighted matrix. Ask for the options and the criteria, have the user set the weights, then score each option and show the totals. Point out where a close score depends on one criterion.' },

        // Create
        { id: 'idea-spark', category: 'create', name: 'Idea Spark', tagline: 'Out-of-the-box concepts with structured bullets.', prompt: 'You are a creative brainstorming engine. Generate out-of-the-box ideas, architectural blueprints, script writing angles, and unique strategic concepts based on user prompts. Deliver responses using highly structured bullet points.' },
        { id: 'naming-studio', category: 'create', name: 'Naming Studio', tagline: 'Names, taglines and slogans for products.', prompt: 'You generate names and taglines. Give twenty name ideas grouped by style (descriptive, invented, metaphor), check each for obvious conflicts you know of, and then suggest three taglines for the top picks.' },
        { id: 'prompt-engineer', category: 'create', name: 'Prompt Engineer', tagline: 'Rewrites your prompts for better AI results.', prompt: 'You improve prompts for AI models. Identify what is missing (goal, context, format, constraints, examples), rewrite the prompt, and explain each change in one line. Offer a short and a detailed version.' },
        { id: 'game-master', category: 'create', name: 'Text Game Master', tagline: 'Interactive text adventures with real choices.', prompt: 'You run a text adventure. Describe the scene in under 120 words, end with three numbered choices plus a free option, and keep the world rules and inventory consistent. Wait for the player\'s choice every turn.' },
        { id: 'video-script', category: 'create', name: 'Short Video Scripts', tagline: 'Hooks and beats for TikTok, Reels and Shorts.', prompt: 'You write short-form video scripts under 60 seconds. Start with a hook in the first three seconds, then beats with on-screen text and voiceover lines, then a call to action. Offer three hook variants.' },

        // Languages
        { id: 'translator', category: 'languages', name: 'Translator', tagline: 'Fluent translation that keeps idioms and tone.', prompt: 'You are an advanced expert translator. Your sole purpose is to translate any text provided into high-quality, fluent English (or the language specified by user), keeping idioms and contextual tone perfectly intact. Avoid chatbot greetings.' },
        { id: 'grammar-tutor', category: 'languages', name: 'Grammar Tutor', tagline: 'Corrects your writing and explains each rule.', prompt: 'You correct the user\'s writing in their target language. Show the corrected text, then list each mistake with the rule behind it in one or two sentences. Adjust the level of explanation to the learner\'s stated level.' },
        { id: 'conversation-partner', category: 'languages', name: 'Conversation Partner', tagline: 'Practise speaking with gentle corrections.', prompt: 'You are a conversation partner for language practice in the language the user chooses. Reply naturally at their level in short messages, then add a brief correction note in English for any mistake. Keep the conversation going with a question.' },

        // Think
        { id: 'devils-advocate', category: 'think', name: 'Devil\'s Advocate', tagline: 'Challenges your plan before reality does.', prompt: 'You argue against the user\'s plan or idea as strongly and fairly as you can. Name the strongest objections, the hidden assumptions, and what would have to be true for the idea to fail. End with the single test that would settle it.' },
        { id: 'fact-checker', category: 'think', name: 'Fact Checker', tagline: 'Separates claims, evidence and uncertainty.', prompt: 'You check claims. Split the text into individual claims, rate each as supported, unsupported or unclear based on your knowledge, and say what evidence would settle it. You cannot browse, so state your knowledge cutoff and tell the user to verify important claims.' },
        { id: 'budget-planner', category: 'think', name: 'Budget Planner', tagline: 'A simple monthly budget you can actually keep.', prompt: 'You help plan personal budgets. Ask for income and fixed costs, group spending into needs, wants and savings, suggest a realistic split, and flag the two categories most likely to overspend. You do not give investment advice.' },
        { id: 'travel-planner', category: 'think', name: 'Travel Planner', tagline: 'Day-by-day itineraries that fit your pace.', prompt: 'You plan trips. Ask for dates, budget, travel style and must-sees if missing. Produce a day-by-day plan with realistic travel times, one backup option per day, and a short packing list. Remind the user to check opening times and visa rules.' }
    ];

    // Custom assistants live on this device only.
    function readCustom() {
        try {
            const list = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
            return Array.isArray(list) ? list : [];
        } catch (e) { return []; }
    }
    function writeCustom(list) {
        localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
    }

    function customAssistants() {
        return readCustom().map(a => Object.assign({ category: 'custom', custom: true }, a));
    }

    function saveCustom({ name, prompt, tagline, category }) {
        const cleanName = String(name || '').trim().slice(0, 60);
        const cleanPrompt = String(prompt || '').trim();
        if (!cleanName || !cleanPrompt) throw new Error('A name and a prompt are required.');
        const list = readCustom();
        const entry = {
            id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name: cleanName,
            prompt: cleanPrompt,
            tagline: String(tagline || '').trim().slice(0, 120) || 'Your own prompt.',
            category: CATEGORIES.some(c => c.id === category) ? category : 'custom',
            createdAt: Date.now()
        };
        list.push(entry);
        writeCustom(list);
        return entry;
    }

    function removeCustom(id) {
        writeCustom(readCustom().filter(a => a.id !== id));
    }

    function all() {
        return FREE_ASSISTANTS.concat(customAssistants());
    }

    function find(id) {
        return all().find(a => a.id === id) || null;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function initials(name) {
        const parts = String(name).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
        return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
    }

    function categoryLabel(id) {
        const c = CATEGORIES.find(x => x.id === id);
        return c ? c.label : 'Custom';
    }

    /**
     * Renders the store into `container`.
     * onUse(assistant) is called when the user installs an assistant.
     * activeId marks the assistant currently in use.
     */
    function renderStore(container, opts) {
        const onUse = opts.onUse;
        const state = { q: '', cat: 'all', showForm: false, activeId: opts.activeId || null };

        container.classList.add('store');
        container.innerHTML = `
            <div class="store-toolbar">
                <label class="store-search">
                    <span class="sr-only">Search assistants</span>
                    <input type="search" class="store-input" placeholder="Search ${all().length} free assistants" data-role="q">
                </label>
                <button type="button" class="store-btn store-btn-primary" data-role="new">New prompt</button>
            </div>
            <div class="store-chips" role="tablist" data-role="chips"></div>
            <form class="store-form hidden" data-role="form" autocomplete="off">
                <div class="store-form-head">
                    <h4>Write your own assistant</h4>
                    <span class="store-note">Saved on this device only. Nothing is uploaded.</span>
                </div>
                <div class="store-form-grid">
                    <label>Name<input class="store-input" name="name" maxlength="60" required placeholder="e.g. Recipe Scaler"></label>
                    <label>Category
                        <select class="store-input" name="category">
                            ${CATEGORIES.filter(c => c.id !== 'custom').map(c => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}
                            <option value="custom" selected>My prompts</option>
                        </select>
                    </label>
                    <label class="store-span-2">One-line description<input class="store-input" name="tagline" maxlength="120" placeholder="What it does, in a few words"></label>
                    <label class="store-span-2">System prompt<textarea class="store-input store-textarea" name="prompt" rows="5" required placeholder="You are an assistant that..."></textarea></label>
                </div>
                <div class="store-form-actions">
                    <button type="button" class="store-btn" data-role="cancel">Cancel</button>
                    <button type="submit" class="store-btn store-btn-primary">Save and use</button>
                </div>
                <p class="store-error hidden" data-role="error"></p>
            </form>
            <div class="store-grid" data-role="grid"></div>
            <p class="store-foot">Every assistant here is free. The prompts run on the AI provider you configure.</p>`;

        const $ = (role) => container.querySelector(`[data-role="${role}"]`);

        function visible() {
            const q = state.q.trim().toLowerCase();
            return all().filter(a => {
                if (state.cat !== 'all' && a.category !== state.cat) return false;
                if (state.cat === 'all' && a.custom) return true;
                if (!q) return true;
                return (a.name + ' ' + a.tagline + ' ' + categoryLabel(a.category)).toLowerCase().includes(q);
            });
        }

        function renderChips() {
            const cats = [{ id: 'all', label: 'All' }].concat(CATEGORIES.filter(c => c.id !== 'custom' || readCustom().length));
            $('chips').innerHTML = cats.map(c => `<button type="button" role="tab" aria-selected="${state.cat === c.id}" class="store-chip" data-cat="${c.id}">${esc(c.label)}</button>`).join('');
        }

        function renderGrid() {
            const list = visible();
            const grid = $('grid');
            if (!list.length) {
                grid.innerHTML = `<div class="store-empty"><strong>No match.</strong><span>Try another word, or write your own prompt.</span></div>`;
                return;
            }
            grid.innerHTML = list.map(a => {
                const active = a.id === state.activeId;
                return `
                <article class="store-card${active ? ' is-active' : ''}">
                    <div class="store-card-top">
                        <span class="store-mark" data-cat="${esc(a.category)}" aria-hidden="true">${esc(initials(a.name))}</span>
                        <span class="store-tag ${a.custom ? 'store-tag-mine' : 'store-tag-free'}">${a.custom ? 'Mine' : 'Free'}</span>
                    </div>
                    <h4 class="store-card-title">${esc(a.name)}</h4>
                    <p class="store-card-desc">${esc(a.tagline)}</p>
                    <div class="store-card-foot">
                        <span class="store-cat">${esc(categoryLabel(a.category))}</span>
                        <span class="store-card-actions">
                            ${a.custom ? `<button type="button" class="store-btn store-btn-ghost" data-remove="${esc(a.id)}" aria-label="Delete ${esc(a.name)}">Delete</button>` : ''}
                            <button type="button" class="store-btn ${active ? '' : 'store-btn-primary'}" data-use="${esc(a.id)}" ${active ? 'disabled' : ''}>${active ? 'In use' : 'Use'}</button>
                        </span>
                    </div>
                </article>`;
            }).join('');
        }

        function renderAll() { renderChips(); renderGrid(); }

        $('q').addEventListener('input', (e) => { state.q = e.target.value; renderGrid(); });
        $('chips').addEventListener('click', (e) => {
            const b = e.target.closest('[data-cat]');
            if (!b) return;
            state.cat = b.dataset.cat;
            renderAll();
        });
        $('new').addEventListener('click', () => {
            state.showForm = !state.showForm;
            $('form').classList.toggle('hidden', !state.showForm);
            if (state.showForm) $('form').querySelector('input[name="name"]').focus();
        });
        $('form').querySelector('[data-role="cancel"]').addEventListener('click', () => {
            state.showForm = false;
            $('form').classList.add('hidden');
            $('form').reset();
            $('error').classList.add('hidden');
        });
        $('form').addEventListener('submit', (e) => {
            e.preventDefault();
            const f = new FormData($('form'));
            try {
                const entry = saveCustom({ name: f.get('name'), prompt: f.get('prompt'), tagline: f.get('tagline'), category: f.get('category') });
                $('form').reset();
                state.showForm = false;
                $('form').classList.add('hidden');
                state.cat = 'all';
                renderAll();
                onUse(entry);
            } catch (err) {
                $('error').textContent = err.message;
                $('error').classList.remove('hidden');
            }
        });
        $('grid').addEventListener('click', (e) => {
            const use = e.target.closest('[data-use]');
            if (use) {
                const a = find(use.dataset.use);
                if (a) onUse(a);
                return;
            }
            const rm = e.target.closest('[data-remove]');
            if (rm && confirm('Delete this prompt from your library?')) {
                removeCustom(rm.dataset.remove);
                renderAll();
            }
        });

        renderAll();
        return {
            setActive(id) { state.activeId = id; renderGrid(); },
            refresh: renderAll
        };
    }

    g.HubLibrary = { FREE_ASSISTANTS, CATEGORIES, all, find, customAssistants, saveCustom, removeCustom, renderStore };
})(typeof window !== 'undefined' ? window : globalThis);
