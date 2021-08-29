require("dotenv").config();
// https://github.com/makenotion/notion-sdk-js
const { Client } = require("@notionhq/client");
const fs = require("fs"),
  util = require("util"),
  path = require("path")

let allPosts = [];
let postMap = null;
let backlinks = [];


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
        const slug = postMap.get(obj.plain_text)
        // the link is to a private Notion page
        if (slug === undefined){
            // no link if there isn't one
            content = `${obj.plain_text}`
        } else {
            // include a link if one exists
            content = `[${obj.plain_text}](${slug})`
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
              results = text
            }  
        }
    }
    return results
}

function formatImage(block){
    if (block.image){
        const caption = block.image.caption[0] ?  block.image.caption[0].plain_text : ''
        return `<img src="${block.image.file.url}" alt="${caption}" >`
    } else return ""
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
 async function createMarkdownFile(post) {
   let resultBlocks = [];
   let max = 20; // max times to loop - will stop at 2000 blocks on a page
   let start = undefined

   for (let i = 0; i < max; i++) {
      const {results, next_cursor, has_more} = await fetchBlocks(post.id, start)
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

    
    
    let text =
      `---\ntitle: "${post.title}"\n` +
      `published: "${post.published}"\n` +
      `featured: "${post.featured}"\n` +
      `updated: "${post.edited.substring(0, 10)}"\n` +
      `completeness: "${post.completeness}"\n` +
      `slug: "${post.slug}"\n` +
      `description: "${post.description}"\n` +
      //`category: "${post.category.toLowerCase()}"\n` +
      `type: "${post.type}"\n---\n\n`;

      //if (post.description.rich_text.length)  console.log({des: post.description.rich_text[0].plain_text})
  
    // Generate text from block
    for (block of flatBlocks[0]) {
      // Blocks can be: paragraph, heading_1, heading_2, heading_3, or 'unsupported' (quote)
    //   if (block.has_children === true){
    //       if (block.type === 'toggle'){
    //           const toggleTitle = block.toggle.text[0].plain_text
    //           const childBlocks = findChildren(block, toggleTitle)
    //           console.log({childBlocks})
    //       }

    //   }  
  

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
            text += formatImage(block)
          break;
        default:
          break;
      }
    }
  
    // Write text to file
    let fileName = `${post.slug}.md`;
    const filePath = path.join(
      process.env.BLOG_DIRECTORY,
      process.env.POSTS_DIRECTORY,
      fileName
    );
  
    fs.writeFile(filePath, text, function err(e) {
      if (e) throw e;
    });
  
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

    // // Pulls the posts in my blog database checked Publish
    // const response2 = await notion.databases
    //   .query({
    //     database_id: process.env.NOTION_DATABASE_ID,
    //     filter: dbFilter,
    //   })
    //   .catch((error) => handleError(error));

  
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
      let posts = await getPostsToPublish();
      allPosts = posts.map(d => [d.title, d.slug])

      postMap = new Map(allPosts)
  
      for (const post of posts) {

        let name = await createMarkdownFile(post);
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

      // fs.writeFile(filePath, JSON.stringify(flatLinks), function err(e) {
      //   if (e) throw e;
      // });

      fs.writeFile(allFilePath, JSON.stringify(flatPosts), function err(e) {
        if (e) throw e;
      });
    } catch (error) {
      status.success = false;
      console.log({error})
      handleError(error);
    }
  
    return status;
  }

  savePosts()