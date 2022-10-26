import type { Context } from "https://edge.netlify.com"

import { camelCase } from "https://deno.land/x/case/mod.ts"
import { unescape } from "https://deno.land/x/html_escape/unescape.ts"
import { HTMLRewriter } from 'https://ghuc.cc/worker-tools/html-rewriter/base64.ts'


// Interfaces, Types, and Vars

interface AstroComponentMetadata {
	displayName: string;
	hydrate?: 'load' | 'idle' | 'visible' | 'media' | 'only';
	hydrateArgs?: any;
	componentUrl?: string;
	componentExport?: { value: string; namespace?: boolean };
}

interface DeconstructedAstroComponent {
	props: any,
	metadata: AstroComponentMetadata
}

interface PropTypeSelector {
	[k: string]: (value: any) => any
}

type ValueOf<T> = T[keyof T];


// Prop Type Map
const propTypes: PropTypeSelector = {
	0: (value) => value,
	1: (value) => JSON.parse(value, reviver),
	2: (value) => new RegExp(value),
	3: (value) => new Date(value),
	4: (value) => new Map(JSON.parse(value, reviver)),
	5: (value) => new Set(JSON.parse(value, reviver)),
	6: (value) => BigInt(value),
	7: (value) => new URL(value),
	8: (value) => new Uint8Array(JSON.parse(value)),
	9: (value) => new Uint16Array(JSON.parse(value)),
	10: (value) => new Uint32Array(JSON.parse(value))
}

const PROP_TYPE = {
	Value: 0,
	JSON: 1,
	RegExp: 2,
	Date: 3,
	Map: 4,
	Set: 5,
	BigInt: 6,
	URL: 7,
	Uint8Array: 8,
	Uint16Array: 9,
	Uint32Array: 10
}


// Helpers

// Reviver method for JSON.parse
const reviver = ( propKey: string, raw: string ): any => {
	
	if ( propKey === '' || !Array.isArray( raw )) {
		return raw
	}
	
	const [ type, value ] = raw
	
	return type in propTypes ? propTypes[ type ]( value ) : undefined
}


// For mapping serialization methods to prop types
const convertToSerializedForm = (
	value: any,
	metadata: AstroComponentMetadata | Record<string, any> = {},
	parents = new WeakSet<any>()
): [ValueOf<typeof PROP_TYPE>, any] => {
	const tag = Object.prototype.toString.call(value);
	switch (tag) {
		case '[object Date]': {
			return [PROP_TYPE.Date, (value as Date).toISOString()];
		}
		case '[object RegExp]': {
			return [PROP_TYPE.RegExp, (value as RegExp).source];
		}
		case '[object Map]': {
			return [
				PROP_TYPE.Map,
				JSON.stringify(serializeArray(Array.from(value as Map<any, any>), metadata, parents)),
			];
		}
		case '[object Set]': {
			return [
				PROP_TYPE.Set,
				JSON.stringify(serializeArray(Array.from(value as Set<any>), metadata, parents)),
			];
		}
		case '[object BigInt]': {
			return [PROP_TYPE.BigInt, (value as bigint).toString()];
		}
		case '[object URL]': {
			return [PROP_TYPE.URL, (value as URL).toString()];
		}
		case '[object Array]': {
			return [PROP_TYPE.JSON, JSON.stringify(serializeArray(value, metadata, parents))];
		}
		case '[object Uint8Array]': {
			return [PROP_TYPE.Uint8Array, JSON.stringify(Array.from(value as Uint8Array))];
		}
		case '[object Uint16Array]': {
			return [PROP_TYPE.Uint16Array, JSON.stringify(Array.from(value as Uint16Array))];
		}
		case '[object Uint32Array]': {
			return [PROP_TYPE.Uint32Array, JSON.stringify(Array.from(value as Uint32Array))];
		}
		default: {
			if (value !== null && typeof value === 'object') {
				return [PROP_TYPE.Value, serializeObject( value, metadata, parents )];
			} else {
				return [PROP_TYPE.Value, value];
			}
		}
	}
}


// Serialize an array
const serializeArray = (
	value: any[],
	metadata: AstroComponentMetadata | Record <string, any> = {},
	parents = new WeakSet <any> ()
): any[] => {
	
	if ( parents.has( value )) {
		throw new Error(`Cyclic reference detected while serializing props for <${metadata.displayName} client:${metadata.hydrate}>!
			Cyclic references cannot be safely serialized for client-side usage. Please remove the cyclic reference.`)
	}
	
	parents.add( value )
	
	const serialized = value.map(( v ) => {
		return convertToSerializedForm( v, metadata, parents )
	})
	
	parents.delete( value )
	
	return serialized
}


// Serialize an object
const serializeObject = (
	value: Record<any, any>,
	metadata: AstroComponentMetadata | Record<string, any> = {},
	parents = new WeakSet<any>()
): Record<any, any> => {
	if (parents.has(value)) {
		throw new Error(`Cyclic reference detected while serializing props for <${metadata.displayName} client:${metadata.hydrate}>!
Cyclic references cannot be safely serialized for client-side usage. Please remove the cyclic reference.`);
	}
	parents.add(value);
	const serialized = Object.fromEntries(
		Object.entries(value).map(([k, v]) => {
			return [k, convertToSerializedForm(v, metadata, parents)];
		})
	);
	parents.delete(value);
	return serialized;
}


// Deconstructor
const deconstruct = ( attrs: Iterable<String[]> ): DeconstructedAstroComponent => {
	
	const { componentUrl, componentExport, client: hydrate, ...metaProps } = Object.fromEntries( Array.from( attrs ).map(([ k, v ]) => [ camelCase( k ), v ]))
	
	// props

	const { name: displayName, value: hydrateArgs } = JSON.parse( unescape( metaProps.opts ))
	const props = JSON.parse( unescape( metaProps.props ), reviver )

	return {
		props,
		metadata: {
			displayName,
			hydrate,
			hydrateArgs,
			componentUrl,
			componentExport
		}
	}
}

// Reconstructor
const reconstruct = ( component: DeconstructedAstroComponent ) => JSON.stringify( serializeObject( component?.props , component?.metadata ))

// END

// Primary Export

export default async ( request: Request, { log, next }: Context ): Promise<Response> => {

	// Get the response from down-chain so we can modify it
	const response = await next()
	const content = await response.text()

	// Extract our URL
	const url = new URL( request.url )

	// Look for the query parameter, and return if we don't find it
	if ( url.searchParams.get( `personal` ) === null ) {
		
		return new Response( content, response )
	}

	const rewrite = new HTMLRewriter()
	const personalizationString = `Personalized Text, Bro!!`

	rewrite
	.on( `astro-island`, {
		element( element ) {

			const attrs = element.attributes
			// log( `Component Attributes: `, attrs )
			let deconstructed = deconstruct( attrs )
			deconstructed.props.text = personalizationString
			// log( deconstructed )
			const reconstructed = reconstruct( deconstructed )
			// log( reconstructed )
			element.setAttribute( `props`, reconstructed )
		},
	})
	.on( `[data-replaceable]`, {
		element( element ) {
			// log( `Found HTML to replace` )
			element.setInnerContent( personalizationString )
		}
	})

	const personalizedDOM = await rewrite.transform( new Response( content )).text()
	// .then( dom => log( dom ))
	// log( personalizedDOM )

	return new Response( personalizedDOM, response )
}

// END Primary Export
