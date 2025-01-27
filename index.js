/**
 * Use node html parser to crawl urls
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Might be connected to a cloudflare worker to add to db, etc.
 *
 * Author: Nathan Turner
 */

import 'dotenv/config';
import mime from 'mime';
import { parse } from 'node-html-parser';
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import fs from "fs";

const { CLOUDFLARE_ACCOUNT_ID, ACCESS_KEY_ID, ACCESS_SECRET_KEY, R2_BUCKET } = process.env;
let numRequests = 0;

// Main URL to crawl
// CHANGE EXAMPLE DATA
let pageurl = 'https://vaporwave.wiki/index.php?title=Category:Cover_Art';

let selectors = [
	{ selector: 'a.mw-file-description', download: false },
	{ selector: '.fullImageLink a', download: true },
	{ selector: 'a[title="Category:Cover Art"]', download: false, text: 'next page' },
	
];

let processedUrls = [], uploadedUrls = [];

const R2 = new S3Client({
	region: "auto",
	endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
	credentials: {
	  accessKeyId: ACCESS_KEY_ID,
	  secretAccessKey: ACCESS_SECRET_KEY,
	},
});

async function fetchAndParseChild(baseurl, relurl) {
	try { 
		if(processedUrls.includes(relurl) || uploadedUrls.includes(`${baseurl}${relurl}`))
			return;
		
		const response = await fetch(`${baseurl}${relurl}`);
		numRequests++;
		processedUrls.push(relurl);
		const html = await response.text();
		const dom = parse(html);
		let urls = [];
		for(const sel of selectors){
			let links = dom.querySelectorAll(sel?.selector.toString());
			for (const link of links) {
				if(sel?.text && link.innerText != sel.text)
					continue;
				let linkhref = link?._attrs ? link?._attrs.href : link?.attrs.href;
				let imageUrl = baseurl + linkhref;
				
				if(sel?.download)
					await uploadFile(imageUrl);
				else if(!processedUrls.includes(linkhref))
					urls.push(linkhref); 				
			}
		}
		urls = Array.from(new Set([...urls]));
		await handleAdditionalUrls(urls, baseurl);
	
	} catch (error) {
		console.error(error);
		throw error;
	}
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function handleAdditionalUrls (urls, baseurl) { 
	return await Promise.all(urls.map(async url => {
		await fetchAndParseChild(baseurl, url);
	}))
}


async function uploadFile (imageUrl) {
	if(uploadedUrls.includes(imageUrl))
		return;
	const filename = decodeURI(imageUrl.split('/').splice(-1)[0]);
	const mime_type = mime.getType(imageUrl);
	const response = await fetch(imageUrl);
	const body = await response.arrayBuffer();
	const params = {
		Bucket: R2_BUCKET,
		Key: `${filename}`,
		Body: body,
		ContentType: mime_type,
	};

	try {
		const command = new PutObjectCommand(params);
		const data = await R2.send(command);
	} catch (err) {
		console.error(err);
		throw err;
	}
	
	fs.appendFile('uploaded_files.txt', imageUrl+'\n', function (err) {
		if (err) throw err;
		console.log('Updated!');
	});
	
}

pageurl = new URL(pageurl); 
let baseurl = pageurl.origin;
let relurl = pageurl.pathname + pageurl.search;

uploadedUrls = fs.readFileSync('uploaded_files.txt').toString().split("\n");

fetchAndParseChild(baseurl, relurl);
		
	

