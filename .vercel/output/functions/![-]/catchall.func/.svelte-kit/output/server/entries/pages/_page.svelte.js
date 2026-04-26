import { a1 as head, a2 as attr } from "../../chunks/renderer.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let query = "";
    head("1uha8ag", $$renderer2, ($$renderer3) => {
      $$renderer3.title(($$renderer4) => {
        $$renderer4.push(`<title>whois — DNS &amp; RDAP lookup</title>`);
      });
    });
    $$renderer2.push(`<main class="svelte-1uha8ag"><div class="container svelte-1uha8ag"><header class="svelte-1uha8ag"><div class="brand svelte-1uha8ag"><span class="brand-name svelte-1uha8ag">whois</span><span class="brand-cursor svelte-1uha8ag">_</span></div> <p class="brand-sub svelte-1uha8ag">DNS records &amp; RDAP domain lookup</p></header> <section class="search-section svelte-1uha8ag"><div class="search-wrap svelte-1uha8ag"><span class="search-prefix svelte-1uha8ag">$</span> <input class="search-input svelte-1uha8ag" type="text" placeholder="example.com"${attr("value", query)} spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="none"/> <button class="search-btn svelte-1uha8ag"${attr("disabled", !query.trim(), true)}>`);
    {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<span class="svelte-1uha8ag">Query</span>`);
    }
    $$renderer2.push(`<!--]--></button></div></section> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div></main>`);
  });
}
export {
  _page as default
};
