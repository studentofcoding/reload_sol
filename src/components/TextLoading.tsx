"use client"
import UserContext from '@/contexts/usercontext';
import React, { useContext } from 'react';

export default function TextLoading() {
    const { loadingText } = useContext<any>(UserContext);

    return (
        <div className="z-50 w-screen md:w-full flex h-full min-h-screen top-0 left-0 bg-black/30 fixed">
            <div className='w-full h-screen bg-cover flex px-8 py-20 justify-center items-center'>
                <div className='relative top-0 left-0 mx- flex flex-col gap-5 justify-center item-center'>
                    <div className='text-xl font-semibold text-[#26c3ff]'>
                        {loadingText}
                    </div>
                    <div
                        className={`inline-block h-14 w-14 animate-spin mx-auto text-text_color-200 rounded-full border-[6px] border-solid border-[#26c3ff] border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]`}
                        role="status">
                        <span
                            className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]"
                        >Loading...</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

