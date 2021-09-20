require("dotenv").config();
// https://github.com/makenotion/notion-sdk-js
const { Client } = require("@notionhq/client");
const fs = require("fs"),
  util = require("util"),
  path = require("path")

const download = require("image-downloader")

let allPosts = [];
let postMap = null;
let quoteMap = null;
let backlinks = [];
let images = [];


// Initializations
const notion = new Client({
    auth: process.env.NOTION_TOKEN,
});
  
const gitOptions = {
    baseDir: process.env.BLOG_DIRECTORY,
};  

const logFile = fs.createWriteStream(__dirname + "/error.log", { flags: "a" });

// Settings
const dbFilter = {
    property: "Published",
    checkbox: {
        equals: true,
    },
};

// Helper Functions
function slugify(string) {
  return string.toString().toLowerCase()
    .replace(/\s+/g, '-')       // Replace spaces with -
    .replace(/[^\w-]+/g, '')    // Remove all non-word chars
    .replace(/--+/g, '-')       // Replace multiple - with single -
    .replace(/^-+/, '')         // Trim - from start of text
    .replace(/-+$/, '')         // Trim - from end of text
}

/**
 * Logs error to file.
 * @param {Error} error Error to log
 */
 function handleError(error) {
    let date = new Date();
    logFile.write(util.format(date.toUTCString() + error.stack) + "\n\n");
  }


  /**
 * Creates Markdown-styled text from Notion provided text object.
 * @param {Object} obj  Text object to style.
 * @returns {string}  Styled text
 */
function styledText(obj) {
    let content = null;

    // text blocks
    if (obj.type === 'text'){
        content = obj.text.content.trim();
        let url = obj.text.link !== null ? obj.text.link.url : null;
        let annots = obj.annotations;
      
        // Manually handle quotes using own notation
        let quote = content.substring(0, 1) === "^";
      
        if (url) {
          content = `[${content}](${url})`;
        }
      
        if (annots.bold) {
          content = `**${content}**`;
        }
      
        if (annots.italic) {
          content = `*${content}*`;
        }
      
        if (annots.strikethrough) {
          content = `~~${content}~~`;
        }
      
        if (annots.code) {
          content = "`" + content + "`";
        }
      
        if (quote) {
          content = "> " + content.substring(2);
        }
    }

    else if (obj.type === "mention"){
        const title = obj.plain_text
        const slug = postMap.get(title)
        const quoteSlug = quoteMap.get(title)
        //const quoteNames = allQuotes//.map(d => d.title)

        // the link is to a private Notion page
        if (slug === undefined && quoteSlug !== undefined){
          console.log({quoteSlug})
            // add special syntax for a quote
            content = `[${title}](quote:${quoteSlug})`
        } else if (slug === undefined && quoteSlug === undefined){
          // no link if there isn't one
          content = `${title}`
        } else {
            // include a link if one exists
            content = `[${title}](${slug})`
        }
    }

    return content;
  }

async function findChildren(block, title){
    const childBlock = await notion.blocks.children.list({
        block_id: block.id
    })
    
    let results;

    for (block of childBlock.results) {
        const type = block.type

        if (type == 'paragraph'){
            const text = block.paragraph.text[0].plain_text

            if (title.includes('Code')){
                const language = title.split("- ")[1]
                const full = "```" + language + "\n" + text + "\n" + "```\n"
                results = full
            } 
            else if (title.includes('Svelte')){
              results = `${text}\n`
            }  
        }
    }
    return results
}

function formatImage(block, slug, imageCount ){
    if (block.image){
        const caption = block.image.caption[0] ?  block.image.caption[0].plain_text : ''
        images.push({slug, fileName: `image-${imageCount}`, url: block.image.file.url})
        const findFilename = new RegExp("[^/]+(.png|.jpg)")
        const fileName = findFilename.exec(block.image.file.url)
        const filePath = `/src/posts/${slug}/${fileName[0]}`
        return `<img src="${filePath}" alt="${caption}" >`
    } else return ""
}

function downloadImage(url, filepath) {
  return download.image({
     url,
     dest: filepath 
  });
}

async function fetchBlocks(id, start){
  const blocks = await notion.blocks.children.list({
    block_id: id,
    start_cursor: start
  });

  return blocks;
}

/**
 * Converts post in Notion into Markdown format.
 * @param {Object} post  Post to convert to Markdown.
 */
 async function createMarkdownFile(post, type) {
   let resultBlocks = [];
   let max = 20; // max times to loop - will stop at 2000 blocks on a page
   let start = undefined
   let imageCount = 0


   for (let i = 0; i < max; i++) {
      const {results, next_cursor, has_more} = await fetchBlocks(post.id, start).catch(err => console.error(err))
      resultBlocks.push(results)
      start = next_cursor

      if (!has_more) break; 
  }


    let flatBlocks;
    if (resultBlocks.length > 1) flatBlocks = [resultBlocks.flat()]
    else flatBlocks = resultBlocks;

    for (block of flatBlocks[0]) {
        const type = block.type

        if (type == 'paragraph'){
            const text = block.paragraph.text

            const mentions = text
                .filter(d => d.type === 'mention')
                .map(d =>({
                    slug: postMap.get(d.plain_text),
                    linkedFrom: post.slug
                }))
                .filter(d => d.slug !== undefined)
                .filter(d => d)

            if (mentions.length){
                backlinks.push(mentions)
            }
        }
    }

    let text = ''

    if (type === 'post'){
      text =
        `---\ntitle: "${post.title}"\n` +
        `published: "${post.published}"\n` +
        `featured: "${post.featured}"\n` +
        `updated: "${post.edited.substring(0, 10)}"\n` +
        `completeness: "${post.completeness}"\n` +
        `slug: "${post.slug}"\n` +
        `description: "${post.description}"\n` +
        //`category: "${post.category.toLowerCase()}"\n` +
        `type: "${post.type}"\n---\n\n`;
    } else if (type === 'quote') {
      text = 
      `---\ntitle: "${post.title}"\n` +
      `slug: "${post.slug}"\n` +
      `resource: "${post.resource}"\n` + 
      `author: "${post.author}"\n` + 
      `url: "${post.url}"\n` + 
      `type: "${post.type}"\n---\n\n`;
    }

    // Generate text from block
    for (block of flatBlocks[0]) {
      // Blocks can be: paragraph, heading_1, heading_2, heading_3, or 'unsupported' (quote)
  
      switch (block.type) {
        case "paragraph":
          text += "\n";
          for (textblock of block.paragraph.text) {
            text += styledText(textblock) + " ";
          }
          text += "\n";
          break;
        case "heading_1":
          text += "\n";
          text += "# " + block.heading_1.text[0].plain_text + "\n";
          break;
        case "heading_2":
          text += "\n";
          text += "## " + block.heading_2.text[0].plain_text + "\n";
          break;
        case "heading_3":
          text += "\n";
          text += "### " + block.heading_3.text[0].plain_text + "\n";
          break;
        case "bulleted_list_item":
        //   const bullets = []
        //   deconstructBulletedList(block)
          text += "\n" + " - ";
          for (textblock of block.bulleted_list_item.text) {
            text +=  styledText(textblock) + " ";
          }
          text += "\n";

          //text += " - " + block.bulleted_list_item.text[0].plain_text + "\n";
          break;
        case "toggle":
          text += "\n";
          const toggleTitle = block.toggle.text[0].plain_text
          text += await findChildren(block, toggleTitle)
          break;
        case "image":
            if (type === 'post'){
              text += formatImage(block, post.slug, imageCount)
              imageCount += 1
            }
          break;
        default:
          break;
      }
    }


  
    // Write text to file
  
    let directory = `${post.slug}`
    let fileName = `index.md`;

    let dirPath = ''

    if (type === 'post'){
      dirPath = path.join(
        process.env.BLOG_DIRECTORY,
        process.env.POSTS_DIRECTORY,
        directory)
    } else if (type === 'quote'){
      dirPath = path.join(
        process.env.BLOG_DIRECTORY,
        process.env.QUOTES_DIRECTORY,
        directory)
    }

    console.log({dirPath})
 
    const filePath = path.join(
      dirPath,
      fileName
    );

    // check if directory exists, if it doesn't, create it
    if (!fs.existsSync(dirPath)){
      fs.mkdirSync(dirPath);
      fs.writeFile(filePath, text, function err(e) {
        if (e) throw e;
      });
    } else {
      fs.writeFile(filePath, text, function err(e) {
        if (e) throw e;
      });
    }
  
    return fileName;
  }


async function queryDatabase(id){
    const content = await notion.databases
    .query({
      database_id: id,
      filter: dbFilter,
    })
    .catch((error) => handleError(error));

    return content
}

async function queryResources(id){
  const content = await notion.databases
    .query({
      database_id: id,
    })
    .catch((error) => handleError(error));

    return content
}

async function getResources(){
  // find all the resources that I have quotes from
  const resourceDB = process.env.NOTION_RESOURCE_DB
  const contents = await queryResources(resourceDB)


  const response = contents.results.map(d => [d.id,d.properties.Name.title[0].plain_text ])
  return new Map(response)
}

async function getQuotes(){
  // find the resource information
  const resourceMap = await getResources()

  // then find all the quotes I liked
  const quoteDB = process.env.NOTION_QUOTE_DB
  const contents = await queryResources(quoteDB)
  const response = contents.results//.concat(res[1].results)
  const allQuotes = contents.results.map(d => [d.properties.Name.title[0].plain_text, slugify(d.properties.Name.title[0].plain_text)]);
  quoteMap = new Map(allQuotes)
  
  let quotes = [];

  if (response) {
    const full_quotes = response.length > 0 ? response : [];

    for (const quote of full_quotes) {
      quotes.push({
        title: quote.properties.Name.title[0].plain_text,
        resource: resourceMap.get(quote.properties['Resource'].relation[0].id),
        author: quote.properties['Author'].rollup.array[0].text[0].plain_text,
        url: quote.properties['Source'].rollup.array[0].url,
        type: quote.properties['Source Type'].rollup.array[0].select.name,
        slug: slugify(quote.properties.Name.title[0].plain_text),
        id: quote.id
      })
    }
  }
  return quotes
}

/**
 * Get posts to publish, including all relevant properties.
 */
 async function getPostsToPublish() {
    const res = [];
    const databaseIDs = process.env.NOTION_DATABASE_ID.split(',')

    for (const id of databaseIDs){
        const contents = await queryDatabase(id)
        res.push(contents)
    }

    const response = res[0].results.concat(res[1].results)
  
    let posts = [];
    if (response) {
      const full_posts = response.length > 0 ? response : [];
      // Pulls relevant properties of the posts
      for (const post of full_posts) {

        posts.push({
          title: post.properties.Name.title[0].plain_text,
          id: post.id,
          custom: post.properties['Custom Created'],
          created: post.created_time,
          published: post.properties['Custom Created'] ? post.properties['Custom Created'].date.start :  post.created_time.substring(0, 10),
          featured: post.properties.Featured.checkbox,
          edited: post.last_edited_time,
          description: post.properties.Description.rich_text.length === 0 ? '' : post.properties.Description.rich_text[0].plain_text,
          slug: post.properties.Slug.rich_text[0].plain_text,
          type: post.properties.Type ? post.properties.Type.select.name : '',
          completeness: post.properties.Completeness ? post.properties.Completeness.select.name : ''
          // category: post.properties.Category.select.name,
        });
      }
    }
    return posts;
  }

function returnBacklinks(slug){
  return backlinks.flat().filter(d => d.slug === slug).map(d => d.linkedFrom)
}

async function processQuotes(){
  let quotes = await getQuotes()
  
  for (const quote of quotes){
    let name = await createMarkdownFile(quote, type = 'quote')
  }


}

async function processPosts(){
  let posts = await getPostsToPublish();
  allPosts = posts.map(d => [d.title, d.slug])

  postMap = new Map(allPosts)

  for (const post of posts) {
    let status = {
      success: true,
      posts: [],
    };

    let name = await createMarkdownFile(post, type = 'post');
    status.posts.push({ id: post.id, name });
  }

  const allFilePath = `${process.env.BLOG_DIRECTORY}/src/posts.json`
  const flatPosts = posts.map(d => ({
      title: d.title, 
      published: d.published, 
      featured: d.featured, 
      edited: d.edited, 
      description: d.description, 
      slug: d.slug, 
      type: d.type, 
      completeness: d.completeness,
      backlinks: returnBacklinks(d.slug)
  }))
    .flat()

  fs.writeFile(allFilePath, JSON.stringify(flatPosts), function err(e) {
    if (e) throw e;
  });

  // download files to appropriate locations
  images.forEach(image => {
    const {slug, fileName, url} = image;
    const filepath = `${process.env.BLOG_DIRECTORY}/src/posts/${slug}`
    downloadImage(url, filepath)
  })
}

/**
 * Saves newly published posts from Notion into post directory for SvelteKit site.
 * @returns Status object with properties: success (bool) and posts (list of post names)
 */
 async function savePosts() {
  let status = {
    success: true,
    posts: [],
  };
  
    try {
      processPosts(status)
      processQuotes().catch(err => console.error(err))


    } catch (error) {
      status.success = false;
      console.log({error})
      handleError(error);
    }
  
    return status;
  }

  savePosts()